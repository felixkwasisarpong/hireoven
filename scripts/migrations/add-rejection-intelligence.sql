-- Rejection Pattern Intelligence — crowdsourced rejection tracking
-- Run against your Hireoven Postgres (Coolify / self-hosted).

-- ── Submissions ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rejection_submissions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID        NOT NULL,
  job_id               UUID        REFERENCES public.jobs(id) ON DELETE SET NULL,
  company_id           UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  normalized_title     TEXT        NOT NULL DEFAULT '',

  application_stage    TEXT        NOT NULL
    CHECK (application_stage IN ('applied','phone_screen','technical','final','offer')),

  outcome              TEXT        NOT NULL
    CHECK (outcome IN ('rejected','ghosted','withdrew','offer_received')),

  rejection_reason     TEXT,
  days_to_response     INTEGER,
  had_referral         BOOLEAN     NOT NULL DEFAULT FALSE,
  applied_within_48hrs BOOLEAN     NOT NULL DEFAULT FALSE,

  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rej_subs_company_title_idx
  ON public.rejection_submissions (company_id, normalized_title);
CREATE INDEX IF NOT EXISTS rej_subs_user_idx
  ON public.rejection_submissions (user_id);

COMMENT ON TABLE public.rejection_submissions IS
  'Anonymised rejection reports submitted by users after each application outcome.';

-- ── Profile snapshots ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rejection_profile_snapshots (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id           UUID        NOT NULL
    REFERENCES public.rejection_submissions(id) ON DELETE CASCADE,

  years_of_experience     INTEGER,
  visa_status             TEXT
    CHECK (visa_status IN ('citizen','green_card','h1b','opt','tn','other')),
  highest_degree          TEXT
    CHECK (highest_degree IN ('high_school','bachelors','masters','phd','bootcamp','other')),
  has_quantified_bullets  BOOLEAN,
  skill_tags              TEXT[]      NOT NULL DEFAULT '{}',
  target_salary           INTEGER,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rej_snap_submission_idx
  ON public.rejection_profile_snapshots (submission_id);

COMMENT ON TABLE public.rejection_profile_snapshots IS
  'Point-in-time snapshot of the submitter profile at time of rejection report.';

-- ── Patterns (recomputed on schedule) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rejection_patterns (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              UUID        REFERENCES public.companies(id) ON DELETE CASCADE,
  job_title_normalized    TEXT        NOT NULL,

  total_submissions       INTEGER     NOT NULL DEFAULT 0,
  phone_screen_rate       DECIMAL(6,4),
  technical_rate          DECIMAL(6,4),
  final_rate              DECIMAL(6,4),
  offer_rate              DECIMAL(6,4),
  median_days_to_response INTEGER,
  top_missing_skills      TEXT[]      NOT NULL DEFAULT '{}',

  referral_screen_rate    DECIMAL(6,4),
  cold_apply_screen_rate  DECIMAL(6,4),
  h1b_screen_rate         DECIMAL(6,4),
  citizen_screen_rate     DECIMAL(6,4),
  early_apply_screen_rate DECIMAL(6,4),
  late_apply_screen_rate  DECIMAL(6,4),

  last_computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, job_title_normalized)
);

CREATE INDEX IF NOT EXISTS rej_patterns_company_idx
  ON public.rejection_patterns (company_id, job_title_normalized);

COMMENT ON TABLE public.rejection_patterns IS
  'Aggregated rejection patterns per company + normalised role, recomputed every 6 hours.';
