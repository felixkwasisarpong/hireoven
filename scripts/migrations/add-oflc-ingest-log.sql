-- Migration: add-oflc-ingest-log
--
-- Tracks which OFLC disclosure files have been ingested, so a scheduled refresh can detect a new
-- quarterly drop and skip work that is already done.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS: the §2 Green Card Radar has a shelf life. Prevailing wage
-- determinations are valid 90 days to 1 year, so once a disclosure file ages past that, every row
-- in it has expired and the radar returns NOTHING. Measured on the FY2026 Q3 file at load time:
-- 15,640 live signals, all expiring within 0-41 days. A stale file does not degrade that feature,
-- it silently empties it. OFLC publishes in Feb/May/Aug/Dec (5-7 weeks after quarter end), and
-- the wage tables annually on 1 July.
--
-- APPLY:
--   psql "$DATABASE_URL" -f scripts/migrations/add-oflc-ingest-log.sql

CREATE TABLE IF NOT EXISTS oflc_ingest_log (
  dataset       TEXT        NOT NULL,   -- 'lca' | 'perm' | 'pwd' | 'wages'
  file_label    TEXT        NOT NULL,   -- 'FY2026_Q3' / '2026-27'
  source_url    TEXT        NOT NULL,
  content_bytes BIGINT,                 -- re-import if DOL republishes the same label at a new size
  rows_imported INTEGER,
  status        TEXT        NOT NULL DEFAULT 'ok',  -- 'ok' | 'failed'
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  PRIMARY KEY (dataset, file_label)
);

CREATE INDEX IF NOT EXISTS idx_oflc_ingest_log_recent
  ON oflc_ingest_log (dataset, started_at DESC);
