-- Interview live session credits
-- One credit = one live session slot (any duration).
-- Cost per session: ≤30 min = 4 credits, ≤60 min = 7 credits.
-- Pro Max subscribers receive 8 free credits on each billing cycle (lazy grant).

CREATE TABLE interview_credit_balances (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance    INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE interview_credit_transactions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount                   INT NOT NULL,    -- positive = grant, negative = deduct
  reason                   TEXT NOT NULL,   -- 'purchase' | 'monthly_pro_max_grant' | 'session_deduct' | 'refund'
  session_id               UUID REFERENCES interview_sessions(id) ON DELETE SET NULL,
  stripe_payment_intent_id TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_user ON interview_credit_transactions(user_id, created_at DESC);

-- Prevent double-deduction on reconnect: set to TRUE when credits are deducted
-- for a live session (checked in the realtime-token route).
ALTER TABLE interview_sessions
  ADD COLUMN IF NOT EXISTS credit_deducted BOOLEAN NOT NULL DEFAULT FALSE;
