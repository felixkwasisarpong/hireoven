-- Migration: add-personal-scorecards
-- Personal Sponsorability Scorecard (Spec 04). One row per user; recompute updates in place.
-- share_token is generated only on explicit public opt-in; consented_at records the
-- click-through consent and gates the public-share API (decision 6).
--
-- APPLY (no migration runner in repo):
--   psql "$DATABASE_URL" -f scripts/migrations/add-personal-scorecards.sql

CREATE TABLE IF NOT EXISTS public.personal_scorecards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  share_token       TEXT UNIQUE,                       -- NULL until public opt-in
  is_public         BOOLEAN NOT NULL DEFAULT false,
  consented_at      TIMESTAMPTZ,                       -- set when the user accepts the share consent
  display_name      TEXT,                             -- user-controlled; sanitized in app code

  total_score       INTEGER NOT NULL,
  grade             TEXT NOT NULL,
  components_jsonb  JSONB NOT NULL,                    -- full PersonalScoreResult snapshot
  resume_hash       TEXT NOT NULL,                     -- detect resume changes between computations

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shared_at         TIMESTAMPTZ,                       -- first time public share was enabled
  view_count        INTEGER NOT NULL DEFAULT 0,
  share_count       INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS personal_scorecards_user_id_uidx
  ON public.personal_scorecards (user_id);
CREATE INDEX IF NOT EXISTS personal_scorecards_share_token_idx
  ON public.personal_scorecards (share_token) WHERE share_token IS NOT NULL;
