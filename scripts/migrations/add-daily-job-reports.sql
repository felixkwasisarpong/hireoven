-- Daily Fresh Jobs Report
--
-- Stores one durable snapshot per UTC day of what was discovered that day:
-- new-job counts, AI / remote / new-grad breakdowns, companies-with-sponsorship
-- history, and the top companies / roles / locations. The snapshot is written
-- nightly by api/cron/daily-report and read by the public /report pages and the
-- shareable OG card.
--
-- Why a stored snapshot rather than computing on read: job-retention purges
-- listings after ~30 days, so "150 AI jobs posted on 2026-03-01" can only be
-- reproduced from a point-in-time capture. Keying by report_date makes the
-- write idempotent (re-running the cron overwrites the same row).

CREATE TABLE IF NOT EXISTS daily_job_reports (
  report_date  DATE        PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload      JSONB       NOT NULL
);

-- The public "latest report" query orders by report_date DESC; the PK index
-- already serves that, but keep an explicit comment for future readers.
COMMENT ON TABLE daily_job_reports IS
  'Point-in-time daily discovery snapshots for the public Fresh Jobs Report. Written by api/cron/daily-report.';
