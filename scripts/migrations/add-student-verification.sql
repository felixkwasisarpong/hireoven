-- Student verification — OTP-confirmed .edu email gives the user a permanent
-- "is_student" flag, which auto-attaches a Stripe promotion code at checkout.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_student            boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS student_email         text,
  ADD COLUMN IF NOT EXISTS student_verified_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_is_student ON profiles (id) WHERE is_student = true;

-- OTP rows. One unconsumed row per (user_id, email) at a time — when the user
-- requests a new code, the previous one is invalidated by setting expires_at
-- in the past (the send route handles this).
CREATE TABLE IF NOT EXISTS student_verifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  code_hash     text NOT NULL,           -- SHA-256 of the 6-digit code
  attempts      int  NOT NULL DEFAULT 0,
  consumed_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_student_verifications_active
  ON student_verifications (user_id, email, created_at DESC)
  WHERE consumed_at IS NULL;
