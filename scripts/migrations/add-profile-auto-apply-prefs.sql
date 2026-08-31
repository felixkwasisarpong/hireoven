-- The two profile columns overnight auto-apply reads, neither of which existed.
--
-- `auto_apply_prefs` has been referenced by lib/apex/auto-apply/store.ts since
-- that file was written. Every read threw, the store's catch returned defaults,
-- and every write was discarded — so a user could "enable" auto-apply and the
-- setting would vanish. Same class of failure as apex_auto_apply_log, which was
-- also referenced for months without existing.
--
-- `timezone` is what makes "overnight" mean the user's night rather than the
-- server's. Without it the cron's WHERE clause referenced a missing column, the
-- query errored, the catch swallowed it, and the sweep would have selected zero
-- users every hour forever while reporting success.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_apply_prefs jsonb,
  -- IANA name, e.g. America/Chicago. Null falls back to UTC, which is wrong for
  -- most users but at least deterministic.
  ADD COLUMN IF NOT EXISTS timezone text;

COMMENT ON COLUMN public.profiles.auto_apply_prefs IS
  'AutoApplyPreferences: enabled flag + criteria. See lib/apex/auto-apply/types.ts.';
COMMENT ON COLUMN public.profiles.timezone IS
  'IANA timezone. Decides when "overnight" is for this user, and anchors their weekly/nightly caps.';

-- The cron sweeps on (enabled, local hour), so an index on the opt-in flag keeps
-- it from scanning every profile every hour.
CREATE INDEX IF NOT EXISTS idx_profiles_auto_apply_enabled
  ON public.profiles ((auto_apply_prefs->>'enabled'))
  WHERE auto_apply_prefs IS NOT NULL;
