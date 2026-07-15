-- Referral system
-- Referrer earns 14 days free Pro per conversion, capped at 3 referrals
-- Referee earns 7 days free Pro on signup

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code
  ON profiles (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS referrals (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id               UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referee_id                UUID        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status                    TEXT        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'converted', 'expired')),
  referee_reward_granted_at TIMESTAMPTZ,
  referrer_reward_granted_at TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_at              TIMESTAMPTZ,

  -- One referral record per new user (prevent double-claiming)
  UNIQUE (referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals (referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_pending
  ON referrals (created_at)
  WHERE status = 'pending';
