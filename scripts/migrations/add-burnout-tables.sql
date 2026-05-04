-- Burnout Detection Agent — engagement state tracking
-- Run against Hireoven Postgres.

DO $$ BEGIN
  CREATE TYPE burnout_state_enum AS ENUM ('healthy', 'slowing', 'stalled', 'burnt_out', 'anxious');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE burnout_confidence_enum AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE session_quality_enum AS ENUM ('deep', 'moderate', 'passive', 'bounce');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── user_burnout_states ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_burnout_states (
  id                      UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID                    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  state                   burnout_state_enum      NOT NULL DEFAULT 'healthy',
  confidence              burnout_confidence_enum NOT NULL DEFAULT 'low',
  signals                 JSONB                   NOT NULL DEFAULT '[]',
  intervention_type       TEXT                    NOT NULL DEFAULT 'none',
  intervention_shown_at   TIMESTAMPTZ,
  user_responded          BOOLEAN                 NOT NULL DEFAULT false,
  response_action         TEXT,
  classified_at           TIMESTAMPTZ             NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ             NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_burnout_states_user_latest
  ON public.user_burnout_states(user_id, classified_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_burnout_states_state
  ON public.user_burnout_states(state) WHERE state != 'healthy';

-- ── user_session_quality ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_session_quality (
  id               UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID                NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id       TEXT                NOT NULL,
  duration_seconds INTEGER             NOT NULL DEFAULT 0,
  actions_count    INTEGER             NOT NULL DEFAULT 0,
  apply_attempts   INTEGER             NOT NULL DEFAULT 0,
  saved_jobs       INTEGER             NOT NULL DEFAULT 0,
  search_queries   INTEGER             NOT NULL DEFAULT 0,
  mode_changes     INTEGER             NOT NULL DEFAULT 0,
  session_quality  session_quality_enum NOT NULL DEFAULT 'bounce',
  session_at       TIMESTAMPTZ         NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_session_quality_user
  ON public.user_session_quality(user_id, session_at DESC);
