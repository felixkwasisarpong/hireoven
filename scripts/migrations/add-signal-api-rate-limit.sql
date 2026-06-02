-- Distributed rate limiting windows for Apex Signal API.
-- Shared across replicas via Postgres.

CREATE TABLE IF NOT EXISTS signal_api_rate_limit_windows (
  identity            TEXT NOT NULL,
  window_start_epoch  BIGINT NOT NULL,
  request_count       INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (identity, window_start_epoch),
  CHECK (window_start_epoch >= 0),
  CHECK (request_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_rate_limit_windows_window
  ON signal_api_rate_limit_windows (window_start_epoch);
