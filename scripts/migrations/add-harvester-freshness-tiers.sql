-- Step 1 of the multi-ATS harvester refactor: additive schema only.
-- No existing queries reference the new columns; old crawler keeps working unchanged.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS freshness_tier TEXT
    CHECK (freshness_tier IN ('tier_1','tier_2','tier_3','tier_dead'))
    DEFAULT 'tier_2',
  ADD COLUMN IF NOT EXISTS next_harvest_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS etag TEXT,
  ADD COLUMN IF NOT EXISTS last_modified TEXT,
  ADD COLUMN IF NOT EXISTS discovered_via TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT
    CHECK (status IN ('active','dead','rate_limited','unknown'))
    DEFAULT 'active';

-- Stagger initial next_harvest_at so the worker doesn't see ~10k companies become
-- eligible at the same instant on first boot. Uses a stable hash of the row id to
-- spread across the next 24h.
UPDATE companies
   SET next_harvest_at = now() + (abs(hashtextextended(id::text, 0)) % 86400) * interval '1 second'
 WHERE next_harvest_at IS NULL;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_hash BYTEA,
  ADD COLUMN IF NOT EXISTS source_ats TEXT,
  ADD COLUMN IF NOT EXISTS source_ats_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_companies_next_harvest
  ON companies (next_harvest_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_companies_freshness_tier
  ON companies (freshness_tier, next_harvest_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_jobs_open_first_detected
  ON jobs (first_detected_at DESC)
  WHERE is_active = true AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_company_open
  ON jobs (company_id, first_detected_at DESC)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_remote_open
  ON jobs (is_remote, posted_at DESC NULLS LAST)
  WHERE is_active = true AND closed_at IS NULL;

-- For prod: run `CREATE INDEX CONCURRENTLY` versions of the above outside a
-- transaction if the table is hot. Matches the convention used by the rest of
-- scripts/migrations/, which is forward-only blocking DDL.
