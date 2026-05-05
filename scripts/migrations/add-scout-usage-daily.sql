-- Per-user, per-day Scout message counter used to enforce the free-tier daily quota.
-- One row per (user_id, day). Counted by /api/scout/chat each time a free user sends.
CREATE TABLE IF NOT EXISTS scout_usage_daily (
  user_id    UUID NOT NULL,
  day        DATE NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS scout_usage_daily_day_idx ON scout_usage_daily (day);
