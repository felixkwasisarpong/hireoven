-- Layoff Cohort Collective Applying — schema
-- Run against Hireoven Postgres.

-- ── Enum types ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE cohort_status AS ENUM ('forming', 'active', 'matching', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE employer_request_status AS ENUM ('pending', 'matched', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE interest_status AS ENUM ('interested', 'passed', 'matched', 'hired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── layoff_cohorts ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.layoff_cohorts (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             UUID          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  company_name           TEXT          NOT NULL,
  layoff_event_id        UUID          REFERENCES public.layoff_events(id) ON DELETE SET NULL,
  department             TEXT,
  layoff_date            DATE          NOT NULL,
  status                 cohort_status NOT NULL DEFAULT 'forming',
  member_count           INTEGER       NOT NULL DEFAULT 0,
  avg_years_experience   DECIMAL(4,1),
  avg_salary_usd         INTEGER,
  strength_score         INTEGER       NOT NULL DEFAULT 0 CHECK (strength_score >= 0 AND strength_score <= 100),
  top_skills             TEXT[]        NOT NULL DEFAULT '{}',
  employer_request_count INTEGER       NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_layoff_cohorts_company_id
  ON public.layoff_cohorts(company_id);
CREATE INDEX IF NOT EXISTS idx_layoff_cohorts_status
  ON public.layoff_cohorts(status) WHERE status IN ('forming', 'active', 'matching');
CREATE INDEX IF NOT EXISTS idx_layoff_cohorts_strength
  ON public.layoff_cohorts(strength_score DESC) WHERE status != 'closed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_layoff_cohorts_event_uniq
  ON public.layoff_cohorts(layoff_event_id) WHERE layoff_event_id IS NOT NULL;

-- ── cohort_members ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cohort_members (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id         UUID        NOT NULL REFERENCES public.layoff_cohorts(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_title        TEXT        NOT NULL,
  department        TEXT        NOT NULL,
  years_experience  INTEGER     NOT NULL DEFAULT 0,
  current_salary    INTEGER,
  skills            TEXT[]      NOT NULL DEFAULT '{}',
  linkedin_url      TEXT,
  is_visible        BOOLEAN     NOT NULL DEFAULT true,
  vouches_received  INTEGER     NOT NULL DEFAULT 0,
  vouches_given     INTEGER     NOT NULL DEFAULT 0,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cohort_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_members_cohort
  ON public.cohort_members(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_members_user
  ON public.cohort_members(user_id);

-- ── cohort_vouches ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cohort_vouches (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id    UUID        NOT NULL REFERENCES public.layoff_cohorts(id) ON DELETE CASCADE,
  voucher_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  vouchee_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  relationship TEXT        NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- DB-level constraints: no self-vouching, no duplicate vouches
  CONSTRAINT chk_no_self_vouch CHECK (voucher_id != vouchee_id),
  UNIQUE (cohort_id, voucher_id, vouchee_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_vouches_cohort
  ON public.cohort_vouches(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_vouches_vouchee
  ON public.cohort_vouches(vouchee_id);

-- ── employer_cohort_requests ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employer_cohort_requests (
  id                    UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id             UUID                    NOT NULL REFERENCES public.layoff_cohorts(id) ON DELETE CASCADE,
  company_id            UUID                    REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name          TEXT                    NOT NULL,
  contact_email         TEXT                    NOT NULL,
  roles_needed          TEXT[]                  NOT NULL DEFAULT '{}',
  headcount_requested   INTEGER                 NOT NULL DEFAULT 1,
  message               TEXT,
  status                employer_request_status NOT NULL DEFAULT 'pending',
  matched_member_ids    UUID[],
  created_at            TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employer_cohort_requests_cohort
  ON public.employer_cohort_requests(cohort_id);
CREATE INDEX IF NOT EXISTS idx_employer_cohort_requests_status
  ON public.employer_cohort_requests(status) WHERE status = 'pending';

-- ── cohort_employer_interests ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.cohort_employer_interests (
  id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  cohort_id            UUID            NOT NULL REFERENCES public.layoff_cohorts(id) ON DELETE CASCADE,
  user_id              UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  employer_request_id  UUID            NOT NULL REFERENCES public.employer_cohort_requests(id) ON DELETE CASCADE,
  status               interest_status NOT NULL DEFAULT 'interested',
  created_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE (user_id, employer_request_id)
);

CREATE INDEX IF NOT EXISTS idx_cohort_interests_cohort
  ON public.cohort_employer_interests(cohort_id);
CREATE INDEX IF NOT EXISTS idx_cohort_interests_user
  ON public.cohort_employer_interests(user_id);
