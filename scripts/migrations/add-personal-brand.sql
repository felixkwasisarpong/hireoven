-- Personal Brand Agent — schema
-- Run against Hireoven Postgres.

DO $$ BEGIN
  CREATE TYPE brand_content_type AS ENUM (
    'linkedin_post', 'linkedin_article', 'community_post',
    'recommendation_request', 'profile_update', 'about_section', 'headline'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE brand_idea_status AS ENUM ('pending', 'written', 'posted', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE brand_tone AS ENUM ('professional', 'personal', 'technical', 'warm');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE brand_audit_severity AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── user_brand_profiles ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.user_brand_profiles (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  visibility_score          INTEGER     NOT NULL DEFAULT 0 CHECK (visibility_score BETWEEN 0 AND 100),
  linkedin_url              TEXT,
  linkedin_connected        BOOLEAN     NOT NULL DEFAULT false,
  linkedin_last_synced_at   TIMESTAMPTZ,
  estimated_connections     INTEGER,
  estimated_followers       INTEGER,
  last_post_detected_at     TIMESTAMPTZ,
  days_since_last_activity  INTEGER,
  recommendations_count     INTEGER,
  communities_active        INTEGER     NOT NULL DEFAULT 0,
  headline                  TEXT,
  has_about_section         BOOLEAN,
  skills_count              INTEGER,
  top_skills                TEXT[]      NOT NULL DEFAULT '{}',
  content_topics            TEXT[]      NOT NULL DEFAULT '{}',
  posting_frequency_target  INTEGER     NOT NULL DEFAULT 2,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── brand_content_ideas ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.brand_content_ideas (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID                NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title                 TEXT                NOT NULL,
  hook                  TEXT                NOT NULL,
  content_type          brand_content_type  NOT NULL,
  topic_tags            TEXT[]              NOT NULL DEFAULT '{}',
  estimated_reach_min   INTEGER,
  estimated_reach_max   INTEGER,
  best_day_to_post      TEXT,
  generated_from        TEXT,
  status                brand_idea_status   NOT NULL DEFAULT 'pending',
  draft_content         TEXT,
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_content_ideas_user
  ON public.brand_content_ideas(user_id, created_at DESC);

-- ── brand_content_drafts ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.brand_content_drafts (
  id            UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID                NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idea_id       UUID                REFERENCES public.brand_content_ideas(id) ON DELETE SET NULL,
  content_type  brand_content_type  NOT NULL,
  title         TEXT                NOT NULL,
  content       TEXT                NOT NULL,
  char_count    INTEGER             NOT NULL DEFAULT 0,
  char_limit    INTEGER             NOT NULL DEFAULT 1200,
  version       INTEGER             NOT NULL DEFAULT 1,
  tone          brand_tone          NOT NULL DEFAULT 'professional',
  created_at    TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ         NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_content_drafts_user
  ON public.brand_content_drafts(user_id, created_at DESC);

-- ── brand_audit_items ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.brand_audit_items (
  id            UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID                  NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_type     TEXT                  NOT NULL,
  severity      brand_audit_severity  NOT NULL DEFAULT 'medium',
  title         TEXT                  NOT NULL,
  detail        TEXT                  NOT NULL,
  fix_action    TEXT                  NOT NULL,
  material_icon TEXT                  NOT NULL DEFAULT 'info',
  resolved      BOOLEAN               NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_audit_items_user
  ON public.brand_audit_items(user_id, resolved);

-- ── brand_weekly_actions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.brand_weekly_actions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_of          DATE        NOT NULL,
  actions          JSONB       NOT NULL DEFAULT '[]',
  completed_count  INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_of)
);
