-- Launch offer: withhold the free Pro Max live-interview credit during the first
-- (discounted) billing period of a LAUNCH subscription. The Stripe webhook sets
-- this to the first renewal (current_period_end) when a Pro Max sub is bought
-- with a credit-withholding promo; lib/apex/interview/credits.ts skips the monthly
-- grant while now < hold. NULL for every other subscription (unchanged behavior).
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS interview_credit_hold_until TIMESTAMPTZ;
