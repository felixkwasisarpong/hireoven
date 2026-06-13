-- Immigration marketplace — Stripe Connect partner layer.
-- Vetted partners are Stripe Connect accounts; a matched request is paid via a
-- destination charge (user pays, partner nets, Hireoven keeps the take-rate as
-- the application fee). Idempotent. Run against Hireoven Postgres.

CREATE TABLE IF NOT EXISTS public.service_partners (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT        NOT NULL,
  contact_email       TEXT,
  -- Stripe Connect account id (acct_…). Null until onboarding starts.
  stripe_account_id   TEXT        UNIQUE,
  -- Offering ids this partner can fulfil (matches lib/immigration/services.ts).
  offerings           TEXT[]      NOT NULL DEFAULT '{}',
  active              BOOLEAN     NOT NULL DEFAULT false,
  -- Set true once Stripe reports charges_enabled + details_submitted.
  onboarding_complete BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_partners_active
  ON public.service_partners(active) WHERE active = true;

-- Payment + match columns on the existing request pipeline.
ALTER TABLE public.immigration_service_requests
  ADD COLUMN IF NOT EXISTS partner_id                 UUID REFERENCES public.service_partners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id   TEXT,
  ADD COLUMN IF NOT EXISTS amount_paid_cents          INTEGER,
  ADD COLUMN IF NOT EXISTS paid_at                    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_immigration_requests_partner
  ON public.immigration_service_requests(partner_id) WHERE partner_id IS NOT NULL;
