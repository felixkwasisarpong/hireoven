CREATE TABLE IF NOT EXISTS interview_shared_links (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,
  redact_quotes   BOOLEAN NOT NULL DEFAULT TRUE,
  redact_voice    BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  view_count      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_interview_shared_links_token ON interview_shared_links(token);
CREATE INDEX IF NOT EXISTS idx_interview_shared_links_user ON interview_shared_links(user_id);
