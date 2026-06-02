-- Apex Today Plan state
-- Persists daily plan execution signals so Apex can retain and later learn
-- from which plan items were run, completed, or deferred.

CREATE OR REPLACE FUNCTION update_apex_today_plan_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS apex_today_plan_state (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_date    DATE NOT NULL,
  item_id      TEXT NOT NULL,
  title        TEXT NULL,
  eyebrow      TEXT NULL,
  query        TEXT NULL,
  status       TEXT NULL CHECK (status IN ('done', 'deferred')),
  run_count    INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  last_run_at  TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, plan_date, item_id)
);

CREATE INDEX IF NOT EXISTS idx_apex_today_plan_state_user_day
  ON apex_today_plan_state (user_id, plan_date DESC, updated_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'apex_today_plan_state_updated_at'
  ) THEN
    CREATE TRIGGER apex_today_plan_state_updated_at
      BEFORE UPDATE ON apex_today_plan_state
      FOR EACH ROW EXECUTE FUNCTION update_apex_today_plan_state_updated_at();
  END IF;
END
$$;
