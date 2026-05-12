-- Cross-ATS dedup support.
-- A single role can be posted via multiple ATSes (Greenhouse + Lever, or
-- custom careers page + Workday). The harvester's `(company_id, external_id)`
-- unique index correctly keeps each as a distinct row. This column records
-- which row is the canonical for that role; downstream queries filter
-- `duplicate_of_id IS NULL` to get unique roles.
--
-- Maintenance cron computes this nightly (see lib/harvester/maintenance.ts).
-- The harvester's UPSERT does not touch this column, so canonicalisation
-- survives subsequent harvest cycles.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS duplicate_of_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_duplicate_of_id
  ON jobs (duplicate_of_id)
  WHERE duplicate_of_id IS NOT NULL;

-- Partial index for "canonical active job" queries — the common read path.
CREATE INDEX IF NOT EXISTS idx_jobs_canonical_open
  ON jobs (first_detected_at DESC)
  WHERE is_active = true AND closed_at IS NULL AND duplicate_of_id IS NULL;
