-- Cache resolved direct ATS URLs on the companies row so the cron pipeline
-- never has to re-resolve a wrapper page on subsequent crawl cycles.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS direct_ats_url TEXT,
  ADD COLUMN IF NOT EXISTS direct_ats_provider TEXT,
  ADD COLUMN IF NOT EXISTS direct_ats_identifier TEXT,
  ADD COLUMN IF NOT EXISTS direct_ats_url_resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_companies_direct_ats_resolution
  ON companies (direct_ats_url_resolved_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS idx_companies_last_crawled
  ON companies (last_crawled_at NULLS FIRST)
  WHERE direct_ats_url IS NOT NULL;
