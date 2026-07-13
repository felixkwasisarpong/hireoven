-- Billing idempotency — run against Hireoven Postgres.
--
-- 1) One credit-ledger row per Stripe payment intent per reason: a webhook
--    retry re-delivering checkout.session.completed must not grant twice.
-- 2) One ledger row per (session, reason): one deduct + at most one refund
--    per interview session.
-- 3) feature_credit_packs.refunded_at — set when a charge.refunded event
--    revokes a pack.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_interview_credit_txn_pi_reason
  ON interview_credit_transactions (stripe_payment_intent_id, reason)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_interview_credit_txn_session_reason
  ON interview_credit_transactions (session_id, reason)
  WHERE session_id IS NOT NULL;

ALTER TABLE feature_credit_packs
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
