-- Trigram-fuzzy dedup support.
--
-- Enables pg_trgm (no-op if already installed) and adds a GIN index on
-- jobs.title using trigram ops. The fuzzy dedup phase in maintenance.ts uses
-- the `%` operator to short-circuit pair-wise comparisons across same-company
-- jobs — without this index, each pass becomes O(n^2) per company partition.
--
-- Note: CREATE EXTENSION needs superuser. On Supabase, enable via the
-- Database → Extensions UI; on self-hosted Postgres, run this migration as
-- a superuser-equivalent role.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_jobs_title_trgm
  ON jobs USING GIN (title gin_trgm_ops)
  WHERE is_active = true AND closed_at IS NULL AND duplicate_of_id IS NULL;
