-- Apex Signal API webhook subscriptions, event log, and delivery log.

CREATE TABLE IF NOT EXISTS signal_api_webhook_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL,
  name                  TEXT NOT NULL,
  target_url            TEXT NOT NULL,
  event_types           TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  signing_secret        TEXT NOT NULL,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  last_delivery_at      TIMESTAMPTZ,
  last_failure_at       TIMESTAMPTZ,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (consecutive_failures >= 0)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_subscriptions_tenant
  ON signal_api_webhook_subscriptions (tenant_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_subscriptions_updated
  ON signal_api_webhook_subscriptions (updated_at DESC);

CREATE TABLE IF NOT EXISTS signal_api_webhook_events (
  id           UUID PRIMARY KEY,
  tenant_id    TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_events_tenant_time
  ON signal_api_webhook_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_events_type_time
  ON signal_api_webhook_events (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS signal_api_webhook_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   UUID NOT NULL REFERENCES signal_api_webhook_subscriptions(id) ON DELETE CASCADE,
  event_id          UUID NOT NULL REFERENCES signal_api_webhook_events(id) ON DELETE CASCADE,
  tenant_id         TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  target_url        TEXT NOT NULL,
  attempt_number    INTEGER NOT NULL DEFAULT 1,
  status_code       INTEGER,
  success           BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms       INTEGER,
  error_message     TEXT,
  response_body     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (attempt_number >= 1)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_deliveries_subscription_time
  ON signal_api_webhook_deliveries (subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_deliveries_event_time
  ON signal_api_webhook_deliveries (event_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_deliveries_tenant_time
  ON signal_api_webhook_deliveries (tenant_id, created_at DESC);
