-- Temporary feedback table for the waitlist-phase only.
-- Captures unstructured feedback + optional NPS-style rating from visitors.
-- Drop this table once the waitlist phase ends and we remove the in-app widget.

CREATE TABLE IF NOT EXISTS waitlist_feedback (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT,
  rating      SMALLINT CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  message     TEXT NOT NULL,
  path        TEXT,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waitlist_feedback_created_at
  ON waitlist_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waitlist_feedback_email
  ON waitlist_feedback (email)
  WHERE email IS NOT NULL;
