-- Optional tenant-to-user allowlist for Apex Signal API user-scoped endpoints.
-- When a tenant has one or more rows here, only those users are allowed.

CREATE TABLE IF NOT EXISTS signal_api_tenant_users (
  tenant_id           TEXT NOT NULL,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_signal_api_tenant_users_user
  ON signal_api_tenant_users (user_id);
