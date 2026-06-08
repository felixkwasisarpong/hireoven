-- Partial index that backs job retention (lib/jobs/retention.ts).
-- Without it, purging inactive jobs seq-scans ~2M rows per batch and stalls;
-- with it, the daily job-retention cron finds deletable rows instantly.
--
-- Run CONCURRENTLY in production (no table lock). It cannot run inside a
-- transaction block, so execute this file on its own:
--   psql "$DATABASE_URL" -f scripts/migrations/add-jobs-inactive-retention-index.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_inactive_last_seen
  ON jobs (last_seen_at)
  WHERE is_active = false;
