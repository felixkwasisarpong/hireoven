-- Spec 07 — Embeddable Widgets
-- Two tables:
--   embed_tokens  : optional partner tokens that unlock attribution removal / origin
--                   allowlisting for paid tiers. Tied to a Signal API key. Public
--                   widgets (company/leaderboard) and consumer personal widgets work
--                   WITHOUT a token — the token only changes tier behaviour.
--   embed_events  : privacy-safe impression log (referer DOMAIN + hashed UA only,
--                   never IP, cookie, or raw user-agent). Powers view counts.
--
-- Web-box safety: embed_events is append-only and queried only via the indexed
-- (widget_type, subject_id, created_at) predicate or the daily rollup MV below —
-- never a full scan.

CREATE TABLE IF NOT EXISTS embed_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key_id   uuid NOT NULL REFERENCES signal_api_keys(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  -- 'free' always shows attribution; 'pro'/'whitelabel' may suppress it.
  tier            text NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'whitelabel')),
  label           text,
  show_attribution boolean NOT NULL DEFAULT true,
  -- optional origin allowlist; NULL/empty = any origin (attribution still applies)
  allowed_origins text[],
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

CREATE INDEX IF NOT EXISTS idx_embed_tokens_signal_key
  ON embed_tokens (signal_key_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS embed_events (
  id            bigserial PRIMARY KEY,
  widget_type   text NOT NULL CHECK (widget_type IN ('personal', 'company', 'leaderboard')),
  -- company_id (uuid as text) for company widgets, sha256(share_token) for personal,
  -- NULL for the global leaderboard.
  subject_id    text,
  referer_domain text,            -- registrable host only, e.g. "example.com"
  ua_hash       text,             -- sha256(user-agent), first 16 hex chars
  embed_token_id uuid REFERENCES embed_tokens(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_embed_events_subject
  ON embed_events (widget_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_embed_events_created
  ON embed_events (created_at DESC);

-- Daily rollup for the consumer dashboard ("N views in the last 30 days").
-- Refreshed CONCURRENTLY by the hourly cron; first refresh below is non-concurrent.
DROP MATERIALIZED VIEW IF EXISTS embed_event_daily_mv;
CREATE MATERIALIZED VIEW embed_event_daily_mv AS
SELECT
  widget_type,
  COALESCE(subject_id, '*') AS subject_id,
  date_trunc('day', created_at)::date AS day,
  count(*)::bigint AS views,
  count(DISTINCT referer_domain)::bigint AS distinct_domains
FROM embed_events
WHERE created_at >= now() - interval '90 days'
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX IF NOT EXISTS idx_embed_event_daily_mv_key
  ON embed_event_daily_mv (widget_type, subject_id, day);
