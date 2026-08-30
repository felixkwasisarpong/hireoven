-- Screening answers: the questions employers ask that a résumé cannot answer.
--
-- The coverage measurement stalled at 71.8% with 71 required fields left blank,
-- and porting more browser automation did not move it. The fields were things
-- like "Are you 18 years old or older?", "Are you living in the United States
-- at present?" and "Have you previously been employed by X" — not a mechanism
-- problem, an information problem. We do not know the answers.
--
-- One table serves as both the cache and the backlog: a row with answer IS NULL
-- is a question we hit and could not answer, which is exactly the list to ask
-- the user once. Answer it once, and every future application reuses it.

CREATE TABLE IF NOT EXISTS public.user_screening_answers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Normalized question text; the same question phrased slightly differently
  -- collapses to one key.
  question_key  text NOT NULL,
  -- Original wording, for showing the user what was actually asked.
  question_text text NOT NULL,
  -- NULL = still unanswered. These rows are the queue to ask the user.
  answer        text,
  -- Options the control offered, when it was a dropdown, so the UI can present
  -- the same choices rather than inventing its own.
  options       jsonb,
  -- Company-specific questions ("have you worked at X before") must not be
  -- reused elsewhere. NULL means the answer is general.
  company_scope text,
  times_seen    integer NOT NULL DEFAULT 1,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  answered_at   timestamp with time zone,
  last_seen_at  timestamp with time zone NOT NULL DEFAULT now()
);

-- One row per question per user per scope; repeat encounters bump times_seen.
CREATE UNIQUE INDEX IF NOT EXISTS idx_screening_user_question
  ON public.user_screening_answers (user_id, question_key, COALESCE(company_scope, ''));

-- The backlog query: what should we ask this user, most-encountered first.
CREATE INDEX IF NOT EXISTS idx_screening_pending
  ON public.user_screening_answers (user_id, times_seen DESC)
  WHERE answer IS NULL;

ALTER TABLE public.user_screening_answers ENABLE ROW LEVEL SECURITY;
-- No policy, matching resumes / autofill_profiles on this database: reads go
-- through the server's pooled connection, which scopes every query by user_id.
