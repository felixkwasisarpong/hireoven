-- Companies-level dedup support.
--
-- Multiple `companies` rows can describe the same real-world employer when
-- discovery channels insert independently (manual + crt.sh + github-seeds).
-- The maintenance cron consolidates them by `(ats_type, ats_identifier)`,
-- marking duplicates with this pointer so the worker can skip them.
--
-- Discovery scripts deliberately don't enforce a unique constraint at insert
-- time — they upsert by `careers_url` which differs across channels. This
-- column is the post-hoc canonicalisation.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS duplicate_of_company_id UUID
    REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_companies_duplicate_of
  ON companies (duplicate_of_company_id)
  WHERE duplicate_of_company_id IS NOT NULL;

-- The harvester's claim filter excludes duplicate companies — this partial
-- index speeds the common "claim eligible canonical companies" path.
CREATE INDEX IF NOT EXISTS idx_companies_canonical_next_harvest
  ON companies (next_harvest_at)
  WHERE status = 'active' AND duplicate_of_company_id IS NULL;
