-- Apex Signal API keys (public /api/signal/v1 facade)
-- Stores only SHA-256 hashes of keys; raw secrets are never persisted.

CREATE TABLE IF NOT EXISTS signal_api_keys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT NOT NULL,
  name                TEXT NOT NULL,
  key_hash            TEXT NOT NULL UNIQUE,
  key_prefix          TEXT NOT NULL,
  scopes              TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  default_user_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at          TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ,
  usage_count         BIGINT NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (char_length(key_hash) = 64),
  CHECK (char_length(key_prefix) >= 8),
  CHECK (usage_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_keys_tenant_active
  ON signal_api_keys (tenant_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_api_keys_default_user
  ON signal_api_keys (default_user_id)
  WHERE default_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signal_api_keys_last_used
  ON signal_api_keys (last_used_at DESC NULLS LAST);

-- Optional request-level observability for external API traffic.
CREATE TABLE IF NOT EXISTS signal_api_request_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  UUID REFERENCES signal_api_keys(id) ON DELETE SET NULL,
  tenant_id   TEXT NOT NULL,
  route       TEXT NOT NULL,
  method      TEXT NOT NULL,
  status      INTEGER NOT NULL,
  request_id  TEXT NOT NULL,
  latency_ms  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_api_request_log_tenant_time
  ON signal_api_request_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signal_api_request_log_key_time
  ON signal_api_request_log (api_key_id, created_at DESC);
