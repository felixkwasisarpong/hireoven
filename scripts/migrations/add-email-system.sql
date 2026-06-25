-- Spec 08 — Email Digests + Alerts.
-- Reconciled with existing infra: the watched-companies primitive already exists as
-- `watchlist(user_id, company_id)`, the ESP is Resend, and user email lives in
-- `profiles.email`. This migration adds only the net-new pieces.

-- Per-user email preferences + optional OPT context.
CREATE TABLE IF NOT EXISTS user_email_preferences (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weekly_digest        BOOLEAN NOT NULL DEFAULT true,
  layoff_alerts        BOOLEAN NOT NULL DEFAULT true,
  scorecard_milestones BOOLEAN NOT NULL DEFAULT true,
  opt_expiration       BOOLEAN NOT NULL DEFAULT true,
  lottery_brief        BOOLEAN NOT NULL DEFAULT true,
  weekly_send_day      INTEGER NOT NULL DEFAULT 1,   -- 0=Sun … 6=Sat
  weekly_send_hour     INTEGER NOT NULL DEFAULT 8,   -- 0-23, local
  timezone             TEXT NOT NULL DEFAULT 'America/New_York',
  opt_end_date         DATE,
  stem_opt_end_date    DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Send log: idempotency (unique dedupe_key), observability, compliance.
CREATE TABLE IF NOT EXISTS email_sends (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email_type     TEXT NOT NULL,
  dedupe_key     TEXT NOT NULL,
  to_email       TEXT NOT NULL,
  subject        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued',  -- queued|sent|failed|bounced|unsubscribed|skipped
  attempts       INTEGER NOT NULL DEFAULT 0,
  provider_id    TEXT,
  error_message  TEXT,
  queued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at        TIMESTAMPTZ,
  opened_at      TIMESTAMPTZ,
  clicked_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS email_sends_dedupe_uidx ON email_sends (dedupe_key);
CREATE INDEX IF NOT EXISTS email_sends_user_recent_idx ON email_sends (user_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS email_sends_status_idx ON email_sends (status) WHERE status IN ('queued', 'failed');

-- Global suppression list — once present, NO email type sends to this address.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email          TEXT PRIMARY KEY,
  reason         TEXT NOT NULL,   -- bounce|complaint|manual|unsubscribe_all
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One-click unsubscribe tokens (RFC 8058). email_type NULL = unsubscribe from all.
CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_type  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_unsub_tokens_user_idx ON email_unsubscribe_tokens (user_id);

-- Weekly personal-score snapshots — one row per user per ISO week — so the digest
-- can show "your score changed +N since last week".
CREATE TABLE IF NOT EXISTS personal_scorecard_history (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  iso_week     TEXT NOT NULL,           -- e.g. '2026-W26'
  total_score  INTEGER NOT NULL,
  grade        TEXT NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, iso_week)
);

-- Editorial "one link to read" picks for the weekly digest (manually curated).
CREATE TABLE IF NOT EXISTS weekly_editorial_picks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  blurb       TEXT,
  active_from DATE,
  active_to   DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
