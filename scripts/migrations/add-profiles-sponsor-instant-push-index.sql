-- Visa-aware instant push — supporting index.
-- The jobs webhook, on every sponsor-friendly INSERT, looks up profiles that
-- (need sponsorship) AND (push enabled) AND (instant frequency). That trio is a
-- rare intersection; a partial index turns the lookup into an index scan over a
-- tiny set instead of a full profiles scan on the 4GB web box. Idempotent.

CREATE INDEX IF NOT EXISTS idx_profiles_sponsor_instant_push
  ON public.profiles (id)
  WHERE needs_sponsorship = true AND push_alerts = true AND alert_frequency = 'instant';
