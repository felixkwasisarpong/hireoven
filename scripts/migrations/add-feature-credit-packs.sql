-- Top-up credit packs for metered AI features (scout_message, deep_analysis,
-- interview_prep_turn, autofill, etc.). When a user hits their plan's monthly
-- quota, bumpUsage() consumes from the oldest non-empty pack instead of
-- returning 429. Packs are sold à la carte via /api/billing/packs/checkout
-- and granted in the Stripe webhook handler.

CREATE TABLE IF NOT EXISTS feature_credit_packs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature                  TEXT NOT NULL,
  pack_key                 TEXT NOT NULL,
  credits_granted          INT NOT NULL CHECK (credits_granted > 0),
  credits_remaining        INT NOT NULL CHECK (credits_remaining >= 0),
  amount_cents             INT NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at               TIMESTAMPTZ,
  CHECK (credits_remaining <= credits_granted)
);

CREATE INDEX IF NOT EXISTS idx_feature_credit_packs_active
  ON feature_credit_packs (user_id, feature, created_at)
  WHERE credits_remaining > 0;

CREATE TABLE IF NOT EXISTS feature_credit_pack_consumption (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id           UUID NOT NULL REFERENCES feature_credit_packs(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature           TEXT NOT NULL,
  amount            INT NOT NULL CHECK (amount > 0),
  consumed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_pack_consumption_user
  ON feature_credit_pack_consumption (user_id, feature, consumed_at DESC);
