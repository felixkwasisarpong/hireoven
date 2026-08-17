-- Migration: add-lca-transfer-and-secondary-entity
--
-- Unlocks two features that are already sitting in the LCA disclosure file we ingest but were
-- never mapped into lca_records:
--
--   §4 Transfer Velocity — the LCA form breaks TOTAL_WORKER_POSITIONS into SIX INTEGER COUNTS,
--      one of which (CHANGE_EMPLOYER) is an H-1B transfer. The USCIS Employer Data Hub that every
--      competitor uses collapses transfers, extensions and amendments into one "Continuing"
--      bucket, so per-employer transfer volume is unobtainable there. From DOL it is a GROUP BY.
--
--   §6 Third-Party Placement — SECONDARY_ENTITY / SECONDARY_ENTITY_BUSINESS_NAME name the END
--      CLIENT a worker is actually placed at. This is how "you'd be a Cognizant employee sitting
--      at Google" becomes visible before someone applies.
--
-- VERIFIED against LCA_Disclosure_Data_FY2026_Q3.xlsx (252 MB, 98 columns, 1,032,736 sheet rows
-- of which 437,496 are real — the rest is blank padding, so ALWAYS filter CASE_NUMBER NOT NULL):
--   * The header is `H_1B_DEPENDENT` (underscore). The record-layout PDF's `H-1B_DEPENDENT` is
--     wrong — trust observed headers, not the layout doc.
--   * SECONDARY_ENTITY / H_1B_DEPENDENT / WILLFUL_VIOLATOR use 'Yes'/'No', while
--     FULL_TIME_POSITION uses 'Y'/'N' in the same file. Parse both.
--   * The six count columns are integers that sum to TOTAL_WORKER_POSITIONS. One row is NOT one
--     worker: CONTINUED_EMPLOYMENT and AMENDED_PETITION are the same person re-filed.
--     Correct denominators: rows = applications, TOTAL_WORKER_POSITIONS = positions,
--     NEW_EMPLOYMENT = plausible new hires.
--
-- APPLY:
--   psql "$DATABASE_URL" -f scripts/migrations/add-lca-transfer-and-secondary-entity.sql
--   npm run lca:import:apply -- --file=.cache/LCA_FY2026_Q3.xlsx

ALTER TABLE lca_records
  ADD COLUMN IF NOT EXISTS employer_fein               TEXT,
  -- The six petition-type counts. Integers, not flags; they sum to total_worker_positions.
  ADD COLUMN IF NOT EXISTS new_employment              INTEGER,
  ADD COLUMN IF NOT EXISTS continued_employment        INTEGER,
  ADD COLUMN IF NOT EXISTS change_previous_employment  INTEGER,
  ADD COLUMN IF NOT EXISTS new_concurrent_employment   INTEGER,
  ADD COLUMN IF NOT EXISTS change_employer             INTEGER,   -- >0 == an H-1B TRANSFER
  ADD COLUMN IF NOT EXISTS amended_petition            INTEGER,
  ADD COLUMN IF NOT EXISTS total_worker_positions      INTEGER,
  -- Third-party placement: who you'd actually sit at.
  ADD COLUMN IF NOT EXISTS secondary_entity            BOOLEAN,
  ADD COLUMN IF NOT EXISTS secondary_entity_name       TEXT,
  ADD COLUMN IF NOT EXISTS secondary_entity_normalized TEXT,
  -- Employer posture flags.
  ADD COLUMN IF NOT EXISTS h1b_dependent               BOOLEAN,
  ADD COLUMN IF NOT EXISTS willful_violator            BOOLEAN,
  -- Worksite precision + filing speed (DECISION_DATE - RECEIVED_DATE = how fast they move).
  ADD COLUMN IF NOT EXISTS worksite_postal_code        TEXT,
  ADD COLUMN IF NOT EXISTS worksite_county             TEXT,
  ADD COLUMN IF NOT EXISTS received_date               DATE;

-- §4: transfer lookups are always "recent transfers for this employer / SOC / state".
-- Partial index — only ~a few percent of rows are transfers, so this stays small.
CREATE INDEX IF NOT EXISTS idx_lca_transfers
  ON lca_records (company_id, decision_date DESC)
  WHERE change_employer > 0;

CREATE INDEX IF NOT EXISTS idx_lca_transfers_soc_state
  ON lca_records (soc_code, worksite_state_abbr, decision_date DESC)
  WHERE change_employer > 0;

-- §6: the staffing -> end-client graph is traversed from both ends.
CREATE INDEX IF NOT EXISTS idx_lca_secondary_entity
  ON lca_records (secondary_entity_normalized)
  WHERE secondary_entity_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lca_company_secondary
  ON lca_records (company_id)
  WHERE secondary_entity_normalized IS NOT NULL;

-- FEIN is the employer spine across LCA/PERM/PWD (100% fill in OFLC data).
CREATE INDEX IF NOT EXISTS idx_lca_fein
  ON lca_records (employer_fein)
  WHERE employer_fein IS NOT NULL;
