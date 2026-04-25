-- Run against your Hireoven Postgres (Coolify / self-hosted).
-- Additive JSONB snapshots for upcoming job intelligence features.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS job_intelligence jsonb NULL;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS immigration_profile_summary jsonb NULL,
  ADD COLUMN IF NOT EXISTS hiring_health jsonb NULL;

ALTER TABLE public.job_applications
  ADD COLUMN IF NOT EXISTS application_verdict jsonb NULL;

ALTER TABLE public.job_match_scores
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb NULL;

COMMENT ON COLUMN public.jobs.job_intelligence IS 'Optional aggregate intelligence snapshot for visa fit, blockers, salary intelligence, freshness, ghost job risk, and related signals.';
COMMENT ON COLUMN public.companies.immigration_profile_summary IS 'Optional company immigration profile summary for H1B/LCA and sponsorship signals.';
COMMENT ON COLUMN public.companies.hiring_health IS 'Optional company hiring health snapshot derived from crawl, jobs, and immigration signals.';
COMMENT ON COLUMN public.job_applications.application_verdict IS 'Optional application recommendation snapshot for the user/job/application context.';
COMMENT ON COLUMN public.job_match_scores.score_breakdown IS 'Optional typed score breakdown used by future intelligence UI.';
