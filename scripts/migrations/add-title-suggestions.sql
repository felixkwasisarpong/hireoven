-- title_suggestions: a small, pre-aggregated lookup table that backs the
-- Job-title typeahead on the feed. Computed by stripping salary/hour
-- prefixes and "Full Time / Part Time" suffixes from `jobs.normalized_title`
-- and grouping the cleaned forms with their occurrence counts.
--
-- Refreshed by scripts/refresh-title-suggestions.ts (run nightly after
-- ingest). Live aggregation over the 327k-row jobs table was ~2.6s per
-- keystroke — unusable for typeahead. This table is ~30-70k rows and the
-- trigram GIN index makes ILIKE searches sub-100ms.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS title_suggestions (
  title TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_title_suggestions_title_trgm
  ON title_suggestions USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_title_suggestions_n
  ON title_suggestions (n DESC);

COMMENT ON TABLE title_suggestions IS
  'Pre-aggregated job-title suggestions for the feed typeahead. Populated by refresh-title-suggestions.';
