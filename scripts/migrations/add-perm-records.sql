-- Migration: add-perm-records
--
-- PERM (green-card labor certification) disclosure data. Unlocks:
--   §7 Green Card Follow-Through — 'Certified - Expired' means DOL certified the labor market
--      test and the employer never converted it into an I-140 inside the 180-day window. This is
--      the number that answers "do you actually sponsor green cards", per employer.
--   §2 Green Card Radar — PERM joins to the PWD file via JOB_OPP_PWD_NUMBER (99.96% filled),
--      which is what makes an employer's *pipeline* visible before they file.
--   §3 PERM Test-Ad Detector — the recruitment windows below are the legally-mandated ads an
--      employer must run for a job already promised to a named worker.
--
-- MEASURED against PERM_Disclosure_Data_FY2026_Q3.xlsx (156 MB, 137 columns, 925,431 sheet rows
-- of which 112,550 are real — filter CASE_NUMBER NOT NULL):
--   Certified 87,741 · Certified - Expired 16,287 · Withdrawn 4,643 · Denied 3,879
--   JOB_OPP_PWD_NUMBER filled on 112,507 (99.96%)
--   OTHER_REQ_IS_FW_CURRENTLY_WRK = Y on 78,823 (70.0%) — the job is already held by the
--   foreign worker it is being advertised for.
--
-- ⚠ RIGHT-CENSORING — the trap in §7. The observed expiry rate here is 15.7%, NOT the 38.8%
-- quoted in the source brief. A certification cannot be marked expired until 180 days have
-- passed, so recent certifications are structurally incapable of being expired yet. Any
-- per-employer follow-through rate MUST restrict to certifications whose decision_date is at
-- least 180 days old, or it silently rewards employers who simply filed recently.
--
-- Column names differ from the LCA file — the employer is EMP_BUSINESS_NAME/EMP_FEIN (not
-- EMPLOYER_NAME/EMPLOYER_FEIN) and the occupation is PWD_SOC_CODE. Do not assume symmetry.
--
-- APPLY:
--   psql "$DATABASE_URL" -f scripts/migrations/add-perm-records.sql
--   npx tsx scripts/import-perm-disclosure.ts --file=.cache/PERM_FY2026_Q3.xlsx --apply

CREATE TABLE IF NOT EXISTS perm_records (
  case_number              TEXT PRIMARY KEY,
  case_status              TEXT,
  received_date            DATE,
  decision_date            DATE,

  employer_name            TEXT,
  employer_name_normalized TEXT,
  employer_fein            TEXT,
  employer_naics           TEXT,
  company_id               UUID REFERENCES companies(id) ON DELETE SET NULL,
  -- Self-reported headcount and founding year on every filing: a per-FEIN time series of
  -- company size, for free.
  emp_num_payroll          INTEGER,
  emp_year_commenced       INTEGER,

  -- The join key to the PWD file (§2). 99.96% filled.
  pwd_number               TEXT,
  pwd_soc_code             TEXT,
  pwd_soc_title            TEXT,
  job_title                TEXT,

  worksite_city            TEXT,
  worksite_county          TEXT,
  worksite_state           TEXT,
  worksite_postal_code     TEXT,
  -- DOL supplies the OEWS/BLS area directly here, so PERM rows join to oflc_wage_levels
  -- without going through the city/county resolver.
  worksite_bls_area        TEXT,

  wage_from                NUMERIC,
  wage_to                  NUMERIC,
  wage_unit                TEXT,

  -- 'The job is already held by the worker it is advertised for' — the ghost-job tell (§3).
  fw_currently_working     BOOLEAN,
  -- Self-reported layoff in this or a related occupation in the last 6 months, per SOC (§10).
  employer_layoff          BOOLEAN,

  fiscal_year              INTEGER,
  imported_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perm_employer_norm ON perm_records (employer_name_normalized);
CREATE INDEX IF NOT EXISTS idx_perm_fein          ON perm_records (employer_fein) WHERE employer_fein IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_perm_company       ON perm_records (company_id);
CREATE INDEX IF NOT EXISTS idx_perm_status_date   ON perm_records (case_status, decision_date DESC);
CREATE INDEX IF NOT EXISTS idx_perm_soc_state     ON perm_records (pwd_soc_code, worksite_state);
CREATE INDEX IF NOT EXISTS idx_perm_pwd_number    ON perm_records (pwd_number) WHERE pwd_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_perm_layoff        ON perm_records (pwd_soc_code, worksite_state) WHERE employer_layoff;

-- ---------------------------------------------------------------------------
-- Recruitment windows (§3). One row per advertised channel per case.
--
-- PERM requires a real recruitment campaign — SWA job order, two Sunday newspaper ads, and for
-- professional occupations three more steps from a fixed menu — for a role that in 70% of cases
-- is already held by the sponsored worker. These are the date ranges of those ads, which is what
-- lets us match a live posting we crawled against a filing an employer made to DOL.
--
-- Normalized into its own table (rather than 30 columns) so the overlap join is a range query.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS perm_recruitment_windows (
  case_number TEXT NOT NULL REFERENCES perm_records(case_number) ON DELETE CASCADE,
  channel     TEXT NOT NULL,   -- 'employer_website' | 'job_search_site' | 'swa_job_order' | ...
  from_date   DATE NOT NULL,
  to_date     DATE NOT NULL,
  PRIMARY KEY (case_number, channel, from_date)
);

CREATE INDEX IF NOT EXISTS idx_perm_recr_dates ON perm_recruitment_windows (from_date, to_date);
CREATE INDEX IF NOT EXISTS idx_perm_recr_case  ON perm_recruitment_windows (case_number);
