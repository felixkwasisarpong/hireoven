-- Salary intelligence: weekly digest tracking + intercept event log
-- Run against Hireoven Postgres.

CREATE TABLE IF NOT EXISTS public.user_salary_digests (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_of               DATE        NOT NULL,
  applications_count    INTEGER     NOT NULL DEFAULT 0,
  above_market_count    INTEGER     NOT NULL DEFAULT 0,
  below_market_count    INTEGER     NOT NULL DEFAULT 0,
  above_market_pct      INTEGER     NOT NULL DEFAULT 0,
  below_market_pct      INTEGER     NOT NULL DEFAULT 0,
  detected_floor        INTEGER,
  market_floor          INTEGER,
  gap_percent           INTEGER,
  trend                 TEXT        CHECK (trend IN ('improving', 'stable', 'worsening')),
  recommendation        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_of)
);

CREATE INDEX IF NOT EXISTS idx_user_salary_digests_user
  ON public.user_salary_digests(user_id, week_of DESC);

-- Intercept event log — tracks when users saw salary warnings
CREATE TABLE IF NOT EXISTS public.salary_intercept_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_id          UUID        REFERENCES public.jobs(id) ON DELETE SET NULL,
  job_title       TEXT,
  company_name    TEXT,
  job_salary_max  INTEGER,
  user_market_p50 INTEGER,
  shortfall_pct   INTEGER,
  action_taken    TEXT        NOT NULL CHECK (action_taken IN ('apply_anyway', 'skipped', 'find_better')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_salary_intercept_user
  ON public.salary_intercept_events(user_id, created_at DESC);
