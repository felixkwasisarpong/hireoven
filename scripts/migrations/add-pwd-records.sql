-- Migration: add-pwd-records
--
-- Prevailing Wage Determination (ETA-9141) disclosure data. Unlocks:
--   §2 Green Card Radar — before filing PERM an employer must obtain a PWD. A fresh determination
--      with no matching PERM filing yet is an employer actively preparing to sponsor that
--      occupation at that worksite. PWD_WAGE_EXPIRATION_DATE gives a hard deadline.
--   §5 ACWIA cap-exempt registry — COVERED_BY_ACWIA plus the three statutory prongs are the
--      employer's OWN attestation, under penalty of perjury, of which INA 214(g)(5) exemption
--      they fall under. There is no official cap-exempt list; this is the closest public thing.
--   §9 SOC-override signal — SUGGESTED_SOC_CODE vs PWD_SOC_CODE.
--
-- MEASURED against PW_Disclosure_Data_FY2026_Q3.xlsx (159 MB, 128 columns, 993,158 sheet rows →
-- 147,244 real; filter CASE_NUMBER NOT NULL):
--   VISA_CLASS: PERM 127,621 (86.7%) · H-2B 16,161 · H-1B only 2,022 (1.4%)
--     → the PWD leading indicator is a PERM phenomenon. H-1B employers self-determine the level
--       off the published tables, so do NOT build an H-1B radar on this.
--   COVERED_BY_ACWIA = Y on 5,993. Prongs: higher-ed 3,813 · nonprofit 2,046 · research 303.
--   PWD_WAGE_EXPIRATION_DATE present on 142,634 (96.9%).
--
-- ⚠ THE SOC-OVERRIDE TRAP. SUGGESTED_SOC_CODE carries the O*NET suffix ('15-1252.00') while
-- PWD_SOC_CODE does not ('15-1252'). Comparing them raw reports 99.99% of filings as
-- "DOL overrode the employer's classification". Comparing BARE codes gives the true rate: 16.7%.
-- soc_overridden below is computed on bare codes at import time so no consumer can get this
-- wrong. (Same O*NET-suffix trap as lca_records.soc_code — it has now bitten three times.)
--
-- Employer column is EMPLOYER_LEGAL_BUSINESS_NAME. There is no EMPLOYER_NAME; EMPLOYER_* mostly
-- prefixes point-of-contact fields.
--
-- APPLY:
--   psql "$DATABASE_URL" -f scripts/migrations/add-pwd-records.sql
--   npx tsx scripts/import-pwd-disclosure.ts --file=.cache/PW_FY2026_Q3.xlsx --apply

CREATE TABLE IF NOT EXISTS pwd_records (
  case_number              TEXT PRIMARY KEY,
  case_status              TEXT,
  visa_class               TEXT,

  received_date            DATE,
  determination_date       DATE,
  redetermination_date     DATE,
  -- Validity runs 90 days to 1 year. An unexpired determination with no PERM filed against it
  -- is the sharpest public sponsorship-intent signal we have.
  expiration_date          DATE,

  employer_name            TEXT,
  employer_name_normalized TEXT,
  employer_fein            TEXT,
  company_id               UUID REFERENCES companies(id) ON DELETE SET NULL,

  suggested_soc_code       TEXT,   -- as submitted by the employer (bare, suffix stripped)
  pwd_soc_code             TEXT,   -- as determined by DOL
  pwd_soc_title            TEXT,
  -- Computed on BARE codes at import. See the trap note above.
  soc_overridden           BOOLEAN,
  job_title                TEXT,

  worksite_city            TEXT,
  worksite_county          TEXT,
  worksite_state           TEXT,
  worksite_postal_code     TEXT,

  pwd_wage_rate            NUMERIC,
  pwd_wage_unit            TEXT,
  pwd_oes_wage_level       TEXT,   -- includes an undocumented 'Level V' in some vintages
  required_education_level TEXT,   -- PERM dropped this in 2023; the PWD file still carries it

  -- Employer-attested cap-exempt prongs, INA 214(g)(5).
  covered_by_acwia         BOOLEAN,
  acwia_higher_education   BOOLEAN,
  acwia_affiliated_nonprofit BOOLEAN,
  acwia_research_org       BOOLEAN,

  imported_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pwd_employer_norm ON pwd_records (employer_name_normalized);
CREATE INDEX IF NOT EXISTS idx_pwd_fein          ON pwd_records (employer_fein) WHERE employer_fein IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pwd_company       ON pwd_records (company_id);
CREATE INDEX IF NOT EXISTS idx_pwd_soc_state     ON pwd_records (pwd_soc_code, worksite_state);

-- §2 radar: unexpired PERM determinations, newest first.
CREATE INDEX IF NOT EXISTS idx_pwd_radar
  ON pwd_records (visa_class, expiration_date, determination_date DESC)
  WHERE visa_class = 'PERM';

-- §5 registry: the attested cap-exempt population is small, so a partial index is ideal.
CREATE INDEX IF NOT EXISTS idx_pwd_acwia
  ON pwd_records (employer_fein)
  WHERE covered_by_acwia;
