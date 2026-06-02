-- Glassdoor company discovery is a company-name-only seed source.
-- It does not store jobs, reviews, salaries, private content, or login-gated
-- page content. Discovered names are queued into the existing placeholder
-- resolver path, which later resolves official domains/careers/ATS data.

CREATE TABLE IF NOT EXISTS discovery_jobs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source             TEXT        NOT NULL,
  sector_keyword     TEXT        NOT NULL,
  location_keyword   TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'pending',
  attempts           INTEGER     NOT NULL DEFAULT 0,
  next_run_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, sector_keyword, location_keyword)
);

CREATE INDEX IF NOT EXISTS idx_discovery_jobs_due
  ON discovery_jobs (source, next_run_at, status);

CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status
  ON discovery_jobs (source, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS discovered_company_candidates (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name_raw         TEXT        NOT NULL,
  company_name_normalized  TEXT        NOT NULL,
  source                   TEXT        NOT NULL,
  source_url               TEXT        NOT NULL,
  sector_keyword           TEXT,
  location_keyword         TEXT,
  metadata_json            JSONB       NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  times_seen               INTEGER     NOT NULL DEFAULT 1,
  status                   TEXT        NOT NULL DEFAULT 'pending',
  enqueued_company_id      UUID        REFERENCES companies(id) ON DELETE SET NULL,
  UNIQUE (source, company_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_dcc_source_status
  ON discovered_company_candidates (source, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_dcc_company_name
  ON discovered_company_candidates (company_name_normalized);

CREATE INDEX IF NOT EXISTS idx_dcc_enqueued_company
  ON discovered_company_candidates (enqueued_company_id)
  WHERE enqueued_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS source_run_logs (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source                     TEXT        NOT NULL,
  run_started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_finished_at            TIMESTAMPTZ,
  requests_attempted         INTEGER     NOT NULL DEFAULT 0,
  requests_skipped_by_robots INTEGER     NOT NULL DEFAULT 0,
  companies_found            INTEGER     NOT NULL DEFAULT 0,
  duplicates_skipped         INTEGER     NOT NULL DEFAULT 0,
  status                     TEXT        NOT NULL DEFAULT 'running',
  error_message              TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_run_logs_source_started
  ON source_run_logs (source, run_started_at DESC);
