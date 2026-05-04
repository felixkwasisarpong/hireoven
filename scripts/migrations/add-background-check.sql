-- Background Check Pre-Awareness Tool — schema
-- Run against your Hireoven Postgres.

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE ban_the_box_scope AS ENUM ('all_employers', 'large_employers', 'public_only', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── state_protections ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.state_protections (
  id                              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code                      CHAR(2)       NOT NULL UNIQUE,
  state_name                      TEXT          NOT NULL,
  has_ban_the_box                 BOOLEAN       NOT NULL DEFAULT false,
  ban_the_box_scope               ban_the_box_scope NOT NULL DEFAULT 'none',
  ban_the_box_law_name            TEXT,
  lookback_limit_years            INTEGER,
  lookback_limit_notes            TEXT,
  requires_individual_assessment  BOOLEAN       NOT NULL DEFAULT false,
  allows_expungement_nondisclosure BOOLEAN      NOT NULL DEFAULT false,
  expungement_notes               TEXT,
  credit_check_restricted         BOOLEAN       NOT NULL DEFAULT false,
  credit_check_notes              TEXT,
  last_updated                    DATE          NOT NULL DEFAULT CURRENT_DATE,
  created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── industry_check_profiles ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.industry_check_profiles (
  id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_slug             TEXT          NOT NULL UNIQUE,
  industry_label            TEXT          NOT NULL,
  material_icon             TEXT          NOT NULL,
  typical_lookback_years    INTEGER,
  runs_credit_check         BOOLEAN       NOT NULL DEFAULT false,
  runs_federal_check        BOOLEAN       NOT NULL DEFAULT false,
  fdic_applicable           BOOLEAN       NOT NULL DEFAULT false,
  oig_applicable            BOOLEAN       NOT NULL DEFAULT false,
  security_clearance_possible BOOLEAN     NOT NULL DEFAULT false,
  conviction_risk_level     risk_level    NOT NULL DEFAULT 'low',
  credit_risk_level         risk_level    NOT NULL DEFAULT 'low',
  gap_risk_level            risk_level    NOT NULL DEFAULT 'low',
  notes                     TEXT          NOT NULL DEFAULT ''
);

-- ── fair_chance_employers ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.fair_chance_employers (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID          REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name        TEXT          NOT NULL,
  pledge_type         TEXT          NOT NULL CHECK (pledge_type IN ('fair_chance_pledge', 'ban_the_box', 'second_chance')),
  pledge_source_url   TEXT,
  verified            BOOLEAN       NOT NULL DEFAULT false,
  verified_at         DATE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fair_chance_employers_company_id
  ON public.fair_chance_employers(company_id);

CREATE INDEX IF NOT EXISTS idx_fair_chance_employers_verified
  ON public.fair_chance_employers(verified);
