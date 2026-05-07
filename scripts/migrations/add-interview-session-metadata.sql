-- Add free-form metadata column to interview_sessions for voice timings,
-- reconnect state, and any future per-session annotations.
ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
