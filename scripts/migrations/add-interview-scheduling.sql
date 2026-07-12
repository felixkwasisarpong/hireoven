-- Interview scheduling — schema
-- Live interview sessions can be booked for a future date/time instead of
-- starting immediately. A scheduled session stays in status 'setup' with
-- scheduled_at populated; the existing join flow (setup → active) is unchanged.
-- Run against Hireoven Postgres.

ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_timezone TEXT;

-- Upcoming-bookings lookups: capacity counting for slot suggestions and the
-- user's "upcoming interviews" list.
CREATE INDEX IF NOT EXISTS idx_interview_sessions_scheduled
  ON interview_sessions(scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status = 'setup';

CREATE INDEX IF NOT EXISTS idx_interview_sessions_user_scheduled
  ON interview_sessions(user_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status = 'setup';

-- ── interview_reminders ───────────────────────────────────────────────────────
-- One row per (session, offset). The delivery cron drains rows whose remind_at
-- has passed and marks them sent; cancelling or rescheduling a session deletes
-- its unsent rows.

CREATE TABLE IF NOT EXISTS interview_reminders (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('day_before', 'hour_before', 'starting_soon')),
  remind_at   TIMESTAMPTZ NOT NULL,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_interview_reminders_pending
  ON interview_reminders(remind_at)
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_interview_reminders_session
  ON interview_reminders(session_id);
