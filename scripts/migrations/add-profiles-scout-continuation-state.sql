-- Scout Cross-Device Continuity persistence.
-- Stores a lightweight, non-sensitive workspace continuation payload.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS scout_continuation_state JSONB;

COMMENT ON COLUMN profiles.scout_continuation_state IS
  'Lightweight Scout continuation state (mode, workflow/research context IDs, recent commands, resumable contexts). Must never contain sensitive form values or resume text.';
