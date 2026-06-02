-- Apex Signal API tenant plan quotas + metering windows.
-- Supports billing-grade daily/monthly request enforcement.

CREATE TABLE IF NOT EXISTS signal_api_tenant_quotas (
  tenant_id            TEXT PRIMARY KEY,
  plan_name            TEXT NOT NULL DEFAULT 'starter',
  enforce              BOOLEAN NOT NULL DEFAULT TRUE,
  daily_limit          INTEGER,
  monthly_limit        INTEGER,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (daily_limit IS NULL OR daily_limit > 0),
  CHECK (monthly_limit IS NULL OR monthly_limit > 0)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_tenant_quotas_plan
  ON signal_api_tenant_quotas (plan_name);

CREATE INDEX IF NOT EXISTS idx_signal_api_tenant_quotas_updated_at
  ON signal_api_tenant_quotas (updated_at DESC);

CREATE TABLE IF NOT EXISTS signal_api_quota_daily_usage (
  tenant_id            TEXT NOT NULL,
  day_start            DATE NOT NULL,
  request_count        BIGINT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, day_start),
  CHECK (request_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_quota_daily_usage_day
  ON signal_api_quota_daily_usage (day_start);

CREATE TABLE IF NOT EXISTS signal_api_quota_monthly_usage (
  tenant_id            TEXT NOT NULL,
  month_start          DATE NOT NULL,
  request_count        BIGINT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, month_start),
  CHECK (request_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_quota_monthly_usage_month
  ON signal_api_quota_monthly_usage (month_start);
