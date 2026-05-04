-- Post-Hire Check-in Agent — schema
-- Run against Hireoven Postgres.

DO $$ BEGIN
  CREATE TYPE hired_outcome_status AS ENUM (
    'active', 'left_voluntarily', 'laid_off', 'fired', 'promoted', 'on_leave'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE checkin_type_enum AS ENUM (
    'day_30', 'day_90', 'day_180', 'day_365', 'voluntary', 'exit'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── hired_outcomes ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hired_outcomes (
  id                    UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID                  NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  job_application_id    UUID                  REFERENCES public.job_applications(id) ON DELETE SET NULL,
  company_id            UUID                  REFERENCES public.companies(id) ON DELETE SET NULL,
  role_title            TEXT                  NOT NULL,
  final_salary          INTEGER,
  start_date            DATE,
  offer_accepted_at     TIMESTAMPTZ           NOT NULL DEFAULT now(),
  current_status        hired_outcome_status  NOT NULL DEFAULT 'active',
  left_at               DATE,
  tenure_days           INTEGER               GENERATED ALWAYS AS (
    CASE WHEN left_at IS NOT NULL THEN (left_at - start_date)
         ELSE NULL END
  ) STORED,
  would_recommend_employer BOOLEAN,
  overall_satisfaction  INTEGER               CHECK (overall_satisfaction BETWEEN 1 AND 5),
  created_at            TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hired_outcomes_user
  ON public.hired_outcomes(user_id, offer_accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_hired_outcomes_company
  ON public.hired_outcomes(company_id) WHERE company_id IS NOT NULL;

-- ── post_hire_checkins ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.post_hire_checkins (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  hired_outcome_id      UUID                NOT NULL REFERENCES public.hired_outcomes(id) ON DELETE CASCADE,
  user_id               UUID                NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_id            UUID                REFERENCES public.companies(id) ON DELETE SET NULL,
  checkin_type          checkin_type_enum   NOT NULL,
  scheduled_at          TIMESTAMPTZ         NOT NULL,
  completed_at          TIMESTAMPTZ,
  skipped               BOOLEAN             NOT NULL DEFAULT false,
  responses             JSONB               NOT NULL DEFAULT '{}',
  satisfaction_score    INTEGER             CHECK (satisfaction_score BETWEEN 1 AND 5),
  would_recommend       BOOLEAN,
  compensation_accurate BOOLEAN,
  role_as_described     BOOLEAN,
  culture_as_described  BOOLEAN,
  red_flags_found       BOOLEAN,
  red_flag_details      TEXT,
  planning_to_leave     BOOLEAN,
  leave_timeline_months INTEGER,
  leave_reason          TEXT,
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_post_hire_checkins_user
  ON public.post_hire_checkins(user_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_post_hire_checkins_pending
  ON public.post_hire_checkins(scheduled_at)
  WHERE completed_at IS NULL AND skipped = false;
CREATE INDEX IF NOT EXISTS idx_post_hire_checkins_company
  ON public.post_hire_checkins(company_id) WHERE company_id IS NOT NULL;

-- ── employer_experience_signals ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employer_experience_signals (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  signal_type   TEXT        NOT NULL,
  signal_value  DECIMAL(5,3) NOT NULL,
  source        TEXT        NOT NULL,
  weight        DECIMAL(4,2) NOT NULL DEFAULT 1.0,
  checkin_id    UUID        REFERENCES public.post_hire_checkins(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employer_experience_signals_company
  ON public.employer_experience_signals(company_id, signal_type, created_at DESC);
