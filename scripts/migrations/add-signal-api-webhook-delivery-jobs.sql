-- Async delivery queue for Apex Signal API webhooks.

CREATE TABLE IF NOT EXISTS signal_api_webhook_delivery_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id     UUID NOT NULL REFERENCES signal_api_webhook_subscriptions(id) ON DELETE CASCADE,
  event_id            UUID NOT NULL REFERENCES signal_api_webhook_events(id) ON DELETE CASCADE,
  tenant_id           TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  target_url          TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 1,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at     TIMESTAMPTZ,
  last_status_code    INTEGER,
  last_duration_ms    INTEGER,
  last_error_message  TEXT,
  locked_at           TIMESTAMPTZ,
  locked_by           TEXT,
  delivered_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subscription_id, event_id),
  CHECK (status IN ('pending', 'processing', 'delivered', 'dead_letter')),
  CHECK (attempt_count >= 0),
  CHECK (max_attempts >= 1)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_jobs_pending
  ON signal_api_webhook_delivery_jobs (status, next_attempt_at ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_jobs_subscription
  ON signal_api_webhook_delivery_jobs (subscription_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_api_webhook_jobs_tenant
  ON signal_api_webhook_delivery_jobs (tenant_id, status, updated_at DESC);
