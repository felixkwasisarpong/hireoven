-- Migration: add-cap-exempt-everify (Spec 05)
-- Adds cap-exempt + E-Verify classification to companies, plus the USCIS E-Verify
-- ingestion staging table. companies has no naics_code/is_nonprofit/name_normalized,
-- so the classifier uses name/.edu/industry (in app) and E-Verify matches in app.
--
-- APPLY:
--   psql "$DATABASE_URL" -f scripts/migrations/add-cap-exempt-everify.sql

-- Cap-exempt classification (INA 214(g)(5))
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_cap_exempt          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cap_exempt_reason      TEXT,   -- university | affiliated_nonprofit | govt_research | nonprofit_research
  ADD COLUMN IF NOT EXISTS cap_exempt_confidence  TEXT,   -- high | medium | low
  ADD COLUMN IF NOT EXISTS cap_exempt_source      TEXT,
  ADD COLUMN IF NOT EXISTS cap_exempt_verified_at TIMESTAMPTZ;

-- E-Verify participation (required for STEM OPT extensions)
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_e_verify         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS e_verify_company_id TEXT,
  ADD COLUMN IF NOT EXISTS e_verify_status     TEXT,      -- enrolled | inactive
  ADD COLUMN IF NOT EXISTS e_verify_synced_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS companies_cap_exempt_idx ON public.companies (is_cap_exempt) WHERE is_cap_exempt = true;
CREATE INDEX IF NOT EXISTS companies_e_verify_idx   ON public.companies (is_e_verify)    WHERE is_e_verify    = true;

-- USCIS E-Verify employer list staging table
CREATE TABLE IF NOT EXISTS public.e_verify_employers (
  e_verify_id        TEXT PRIMARY KEY,                    -- USCIS participant ID
  employer_name      TEXT NOT NULL,
  employer_name_norm TEXT NOT NULL,                       -- normalizeEmployerName()
  city               TEXT,
  state              TEXT,
  zip                TEXT,
  industry_naics     TEXT,
  status             TEXT NOT NULL DEFAULT 'enrolled',
  matched_company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  imported_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS e_verify_employers_name_norm_idx ON public.e_verify_employers (employer_name_norm);
CREATE INDEX IF NOT EXISTS e_verify_employers_state_idx     ON public.e_verify_employers (state);
CREATE INDEX IF NOT EXISTS e_verify_employers_matched_idx   ON public.e_verify_employers (matched_company_id) WHERE matched_company_id IS NOT NULL;
