-- Answer bank for application-form questions.
--
-- Why: forms ask the same questions repeatedly ("years of experience with X",
-- "notice period", "are you authorized to work"). Re-answering each one with an
-- LLM is the dominant recurring cost in the apply path. Prompt caching does not
-- help here — it expires in ~5 minutes, so it saves tokens within a single
-- application but nothing across applications.
--
-- Job-specific questions ("why do you want to work here?") are scoped into
-- cache_key by job id, so an answer written for one employer can never be
-- served to another. See lib/autofill/answer-cache.ts.

CREATE TABLE IF NOT EXISTS public.autofill_answer_cache (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- sha256 of (scope + normalized question); scope is "generic" or "job:<id>".
  cache_key          text NOT NULL,
  -- Original question text, kept for debugging and for auditing what was
  -- actually submitted on the user's behalf.
  question           text NOT NULL,
  answer             text NOT NULL,
  -- Ties the entry to the résumé it was grounded in. When the résumé changes
  -- the fingerprint changes, so stale answers are regenerated rather than
  -- contradicting the document uploaded alongside them.
  resume_fingerprint text NOT NULL,
  use_count          integer NOT NULL DEFAULT 1,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at       timestamp with time zone NOT NULL DEFAULT now()
);

-- Backs the ON CONFLICT upsert and the read path in one index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_autofill_answer_cache_user_key
  ON public.autofill_answer_cache (user_id, cache_key);

-- Supports TTL sweeps of entries nothing has touched in a long time.
CREATE INDEX IF NOT EXISTS idx_autofill_answer_cache_last_used
  ON public.autofill_answer_cache (last_used_at);

ALTER TABLE public.autofill_answer_cache ENABLE ROW LEVEL SECURITY;

-- No policy, matching resumes / autofill_profiles / autofill_history on this
-- database: RLS on with no policy denies direct client access outright, and all
-- reads go through the server's pooled connection, which scopes every query by
-- user_id. (auth.uid() is not available here — this instance was migrated off
-- Supabase to plain Postgres, so Supabase's auth helpers no longer exist.)
