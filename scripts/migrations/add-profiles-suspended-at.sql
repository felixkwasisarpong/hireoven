-- Run against your Hireoven Postgres (Coolify / self-hosted).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.suspended_at IS 'When set, user is suspended (app-level; enforced in middleware + admin APIs).';

CREATE INDEX IF NOT EXISTS idx_profiles_suspended_at
  ON public.profiles (suspended_at)
  WHERE suspended_at IS NOT NULL;
