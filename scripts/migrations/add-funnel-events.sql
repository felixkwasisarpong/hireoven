-- Funnel events for the /find ad-landing conversion funnel.
-- Captured first-party in our own Postgres so we can compute exact
-- landing→role→matches→signup conversion and reconcile against Meta,
-- independent of client-side analytics drop-off. Privacy-light: an
-- anonymous first-party visitor id, the event name, and the typed role.
--
-- Run once (e.g. in Supabase SQL editor or via your migration runner).

CREATE TABLE IF NOT EXISTS funnel_events (
  id         BIGSERIAL PRIMARY KEY,
  visitor_id TEXT,
  name       TEXT NOT NULL,
  role       TEXT,
  path       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_name_created
  ON funnel_events (name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_funnel_events_visitor
  ON funnel_events (visitor_id);
