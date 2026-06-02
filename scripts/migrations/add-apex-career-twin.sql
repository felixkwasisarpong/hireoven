-- Apex Career Twin V1
-- Persistent adaptive user model for Apex strategy and planning.

CREATE OR REPLACE FUNCTION update_apex_career_twin_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS apex_career_twin_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  twin_version          INTEGER NOT NULL DEFAULT 1,
  headline              TEXT NOT NULL,
  summary               TEXT NOT NULL,
  strengths             JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  constraints           JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_focus     JSONB NOT NULL DEFAULT '[]'::jsonb,
  primary_role_category TEXT NULL,
  primary_sector        TEXT NULL,
  preferred_work_modes  JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence            INTEGER NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  freshness_score       INTEGER NOT NULL DEFAULT 50 CHECK (freshness_score BETWEEN 0 AND 100),
  evidence_count        INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apex_career_twin_snapshots_user_time
  ON apex_career_twin_snapshots (user_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS apex_career_twin_dimensions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id   UUID NOT NULL REFERENCES apex_career_twin_snapshots(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dimension_key TEXT NOT NULL,
  label         TEXT NOT NULL,
  category      TEXT NOT NULL CHECK (category IN ('fit', 'momentum', 'readiness', 'constraint', 'risk', 'focus')),
  direction     TEXT NOT NULL CHECK (direction IN ('strength', 'risk', 'constraint', 'neutral')),
  score         INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence    INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  evidence      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (snapshot_id, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_apex_career_twin_dimensions_user_time
  ON apex_career_twin_dimensions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS apex_career_twin_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_id UUID NULL REFERENCES apex_career_twin_snapshots(id) ON DELETE SET NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_apex_career_twin_events_user_time
  ON apex_career_twin_events (user_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'apex_career_twin_snapshots_updated_at'
  ) THEN
    CREATE TRIGGER apex_career_twin_snapshots_updated_at
      BEFORE UPDATE ON apex_career_twin_snapshots
      FOR EACH ROW EXECUTE FUNCTION update_apex_career_twin_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'apex_career_twin_dimensions_updated_at'
  ) THEN
    CREATE TRIGGER apex_career_twin_dimensions_updated_at
      BEFORE UPDATE ON apex_career_twin_dimensions
      FOR EACH ROW EXECUTE FUNCTION update_apex_career_twin_updated_at();
  END IF;
END
$$;
