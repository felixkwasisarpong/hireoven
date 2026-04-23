-- =============================================================================
-- Seed auth.users from public.profiles after public schema/data restore
-- =============================================================================

INSERT INTO auth.users (
  id,
  email,
  email_confirmed_at,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.email,
  CASE WHEN p.email IS NULL THEN NULL ELSE NOW() END,
  COALESCE(p.created_at, NOW()),
  COALESCE(p.updated_at, NOW())
FROM public.profiles p
ON CONFLICT (id) DO UPDATE
SET
  email = EXCLUDED.email,
  updated_at = NOW();

