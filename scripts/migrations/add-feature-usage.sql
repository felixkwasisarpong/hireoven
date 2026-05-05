-- Generic per-user, per-feature, per-period usage counter. One row per
-- (user_id, feature, period_start). period_start is the truncated start of the
-- metering window: CURRENT_DATE for daily features, date_trunc('month', now())
-- for monthly features. Callers in lib/usage/quotas.ts pick the period.
CREATE TABLE IF NOT EXISTS feature_usage (
  user_id      UUID NOT NULL,
  feature      TEXT NOT NULL,
  period_start DATE NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, feature, period_start)
);

CREATE INDEX IF NOT EXISTS feature_usage_period_idx ON feature_usage (period_start);
CREATE INDEX IF NOT EXISTS feature_usage_user_period_idx ON feature_usage (user_id, period_start);

-- Backfill Scout's existing daily counter into the generic table so users keep
-- their consumed credits when we cut /api/scout/chat over to bumpUsage.
INSERT INTO feature_usage (user_id, feature, period_start, count, updated_at)
SELECT user_id, 'scout_message', day, count, updated_at
FROM scout_usage_daily
ON CONFLICT (user_id, feature, period_start) DO NOTHING;
