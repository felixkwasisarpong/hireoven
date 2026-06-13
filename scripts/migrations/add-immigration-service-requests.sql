-- Immigration services marketplace — lead/booking pipeline
-- A request is a user's intent to book a brokered immigration service. The
-- quoted price + platform fee are snapshotted at request time (the catalog can
-- change). Fulfilment + partner matching happen out of band. Idempotent.

DO $$ BEGIN
  CREATE TYPE immigration_request_status AS ENUM (
    'requested', 'matched', 'scheduled', 'completed', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.immigration_service_requests (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID                        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  offering_id     TEXT                        NOT NULL,   -- matches SERVICE_OFFERINGS in lib/immigration/services.ts
  category        TEXT                        NOT NULL,
  rush            BOOLEAN                     NOT NULL DEFAULT false,
  -- Pricing snapshot (cents avoided — dollars, matches the catalog).
  quoted_price    INTEGER                     NOT NULL,
  platform_fee    INTEGER                     NOT NULL,
  provider_net    INTEGER                     NOT NULL,
  status          immigration_request_status  NOT NULL DEFAULT 'requested',
  visa_situation  TEXT,                                   -- free-text context from the user
  contact_email   TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_immigration_requests_user
  ON public.immigration_service_requests(user_id, created_at DESC);
-- Ops view: open leads to match/fulfil, newest first.
CREATE INDEX IF NOT EXISTS idx_immigration_requests_open
  ON public.immigration_service_requests(status, created_at DESC)
  WHERE status IN ('requested', 'matched');
