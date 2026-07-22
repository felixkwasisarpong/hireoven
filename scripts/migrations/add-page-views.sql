-- First-party pageview tracking (self-hosted analytics).
--
-- Powers the "Website visitors" metric on /admin/growth without depending on
-- Vercel Analytics (this app runs on Coolify/Hetzner). Privacy-light: stores an
-- anonymous first-party visitor id (random, from the client's localStorage), the
-- path, and the referrer HOST only — no IP, no user-agent, no PII, no
-- cross-site identifiers.
--
-- Unique visitors/day = COUNT(DISTINCT visitor_id) grouped by day.

CREATE TABLE IF NOT EXISTS page_views (
  id            BIGSERIAL   PRIMARY KEY,
  visitor_id    TEXT        NOT NULL,
  path          TEXT        NOT NULL,
  referrer_host TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Time-range scans for the daily rollups.
CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views (created_at);

-- This table grows with traffic. Prune periodically, e.g.:
--   DELETE FROM page_views WHERE created_at < now() - interval '180 days';
