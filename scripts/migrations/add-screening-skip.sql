-- Let a user decline a question permanently.
--
-- Some questions will never be answered — "walk me through setting up a full
-- bar", "are you a Licensed Physical Therapist". Without a way to say so they
-- sit in the backlog forever and, worse, every job asking them is attempted and
-- abandoned. With a nightly cap of five that is a wasted slot, not a wasted
-- second.
--
-- Skipped is distinct from unanswered: unanswered means "we still want to ask",
-- skipped means "stop asking, and do not attempt jobs that require this".
ALTER TABLE public.user_screening_answers
  ADD COLUMN IF NOT EXISTS skipped_at timestamp with time zone;

COMMENT ON COLUMN public.user_screening_answers.skipped_at IS
  'Set when the user declines to answer. The question is never asked again and forms requiring it are abandoned before any LLM spend.';

-- The backlog query wants unanswered AND unskipped.
DROP INDEX IF EXISTS idx_screening_pending;
CREATE INDEX IF NOT EXISTS idx_screening_pending
  ON public.user_screening_answers (user_id, times_seen DESC)
  WHERE answer IS NULL AND skipped_at IS NULL;
