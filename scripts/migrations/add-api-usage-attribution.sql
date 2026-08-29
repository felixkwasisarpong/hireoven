-- Per-user cost attribution for api_usage.
--
-- Why: api_usage recorded only (service, operation, tokens_used, cost_usd), so
-- there was no way to answer "what does this user cost us?" — tokens_used also
-- collapsed input+output into one number, which hides the 5-20x price gap
-- between them and makes prompt-cache savings invisible.
--
-- This is the prerequisite for overnight auto-apply: that feature consumes its
-- quota deterministically (a robot always hits its cap), so it must be priced
-- on measured per-user spend rather than the utilization averages that make the
-- human-initiated quotas safe.
--
-- All columns are nullable — existing rows stay valid and every write site can
-- be migrated incrementally rather than in one atomic change.

ALTER TABLE public.api_usage
  ADD COLUMN IF NOT EXISTS user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS feature        text,
  ADD COLUMN IF NOT EXISTS model          text,
  ADD COLUMN IF NOT EXISTS input_tokens   integer,
  ADD COLUMN IF NOT EXISTS output_tokens  integer,
  -- Prompt-cache accounting. Anthropic bills cache writes at 1.25x base input
  -- and cache reads at 0.1x, so without these two the effective cost of a
  -- cached call cannot be reconstructed from input_tokens alone.
  ADD COLUMN IF NOT EXISTS cache_read_tokens   integer,
  ADD COLUMN IF NOT EXISTS cache_write_tokens  integer,
  -- Groups every AI call belonging to one logical unit of work (e.g. all the
  -- question answers + tailor + cover letter for a single application), so
  -- cost-per-application is a GROUP BY rather than a guess.
  ADD COLUMN IF NOT EXISTS run_id         uuid;

COMMENT ON COLUMN public.api_usage.run_id IS
  'Groups AI calls belonging to one logical unit of work, e.g. one application attempt.';
COMMENT ON COLUMN public.api_usage.tokens_used IS
  'Legacy combined input+output. Prefer input_tokens/output_tokens on new rows.';

-- Per-user spend over a window: the query the circuit breaker and the
-- unit-economics dashboard both run.
CREATE INDEX IF NOT EXISTS idx_api_usage_user_created
  ON public.api_usage (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Cost-per-application rollups.
CREATE INDEX IF NOT EXISTS idx_api_usage_run
  ON public.api_usage (run_id)
  WHERE run_id IS NOT NULL;

-- Backs the existing global daily cap in lib/apex/budget/cap.ts, which today
-- does an unindexed SUM over service='claude' AND created_at >= today.
CREATE INDEX IF NOT EXISTS idx_api_usage_service_created
  ON public.api_usage (service, created_at DESC);
