-- Runtime tables for overnight auto-apply.
--
-- apex_auto_apply_log has been referenced by lib/apex/auto-apply/store.ts since
-- that file was written but was never created. Every write went into the store's
-- catch block, and getTodayAutoApplyCount() therefore returned 0 unconditionally
-- — meaning the daily cap that code appears to enforce has never enforced
-- anything. Creating it is a prerequisite for any cap being real.

CREATE TABLE IF NOT EXISTS public.apex_auto_apply_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id              uuid,
  job_title           text,
  company             text,
  match_score         numeric,
  applied_at          timestamp with time zone NOT NULL DEFAULT now(),
  -- Which criteria qualified this job, for "why did it apply to that?".
  qualified_by        jsonb NOT NULL DEFAULT '{}'::jsonb,
  cover_letter_id     uuid,
  tailored_resume_id  uuid,
  -- applied | failed | skipped_cap | dry_run
  -- dry_run records a full pass that deliberately stopped before submitting, so
  -- a beta can prove the pipeline end-to-end without contacting an employer.
  status              text NOT NULL,
  error               text,
  -- Groups the AI calls for this application in api_usage.run_id, so
  -- cost-per-application is a join rather than an estimate.
  run_id              uuid,
  apply_url           text,
  ats                 text,
  -- What the fill actually achieved, for measuring quality in production the
  -- same way the dry-run harness measures it offline.
  required_total      integer,
  required_filled     integer
);

-- The cap query: applications for one user within a window.
CREATE INDEX IF NOT EXISTS idx_auto_apply_log_user_time
  ON public.apex_auto_apply_log (user_id, applied_at DESC);

-- Never apply to the same posting twice for the same user. A partial unique
-- index rather than a constraint so failed and skipped rows can repeat while
-- successful ones cannot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_apply_log_user_job_applied
  ON public.apex_auto_apply_log (user_id, job_id)
  WHERE status = 'applied' AND job_id IS NOT NULL;

ALTER TABLE public.apex_auto_apply_log ENABLE ROW LEVEL SECURITY;
-- No policy, matching resumes / autofill_profiles on this database: reads go
-- through the server's pooled connection, which scopes every query by user_id.

-- Caps live in the database, not in constants, so they can be retuned without a
-- deploy. The measured cost is ~$0.0005-0.0025 per application, so these are a
-- product/positioning decision rather than a margin one — which is exactly why
-- they need to be adjustable quickly.
CREATE TABLE IF NOT EXISTS public.auto_apply_limits (
  plan              text PRIMARY KEY,
  weekly_cap        integer NOT NULL,
  nightly_cap       integer NOT NULL,
  -- Dollar ceiling per user per calendar month, enforced independently of the
  -- counts. One pathological form (a 30-question Workday, a 15k-token JD) can
  -- blow any per-application model, so the spend cap is the real backstop.
  monthly_usd_cap   numeric(10,4) NOT NULL,
  min_match_score   integer NOT NULL DEFAULT 85,
  enabled           boolean NOT NULL DEFAULT false
);

INSERT INTO public.auto_apply_limits (plan, weekly_cap, nightly_cap, monthly_usd_cap, min_match_score, enabled)
VALUES
  ('free',    0,  0, 0,    85, false),
  ('pro',     0,  0, 0,    85, false),
  -- Pro Max only. Starts disabled: the switch is flipped per environment once a
  -- closed beta has actually submitted applications successfully.
  ('pro_max', 25, 5, 2.50, 85, false)
ON CONFLICT (plan) DO NOTHING;
