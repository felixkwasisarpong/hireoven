-- Scout Memory Engine V1
-- Persistent, server-side, user-controlled memory for Scout AI.
-- Each row is a single piece of long-term context owned by a user.

CREATE TABLE IF NOT EXISTS scout_memories (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What kind of preference or fact this memory represents
  category     TEXT        NOT NULL CHECK (category IN (
    'career_goal',
    'role_preference',
    'company_preference',
    'visa_requirement',
    'salary_preference',
    'workflow_pattern',
    'resume_preference',
    'interview_pattern',
    'search_preference',
    'skill_focus'
  )),

  -- Human-readable summary — what Scout actually uses in prompts
  summary      TEXT        NOT NULL CHECK (char_length(summary) BETWEEN 4 AND 300),

  -- 0.0–1.0: how confident we are this is a real preference
  -- 1.0 = explicitly stated by user, <0.7 = inferred from behavior
  confidence   FLOAT       NOT NULL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),

  -- Where this memory came from
  source       TEXT        NOT NULL DEFAULT 'explicit_user' CHECK (source IN (
    'explicit_user',
    'behavior',
    'workflow',
    'search_history'
  )),

  -- User can disable without deleting; disabled memories never inject into prompts
  active       BOOLEAN     NOT NULL DEFAULT TRUE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by user + active state (primary query pattern)
CREATE INDEX IF NOT EXISTS scout_memories_user_active_idx
  ON scout_memories (user_id, active, updated_at DESC);

-- Fast lookup by category for deduplication during extraction
CREATE INDEX IF NOT EXISTS scout_memories_user_category_idx
  ON scout_memories (user_id, category, active);

-- Row-level security: users can only access their own memories
ALTER TABLE scout_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY scout_memories_owner ON scout_memories
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_scout_memories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scout_memories_updated_at
  BEFORE UPDATE ON scout_memories
  FOR EACH ROW EXECUTE FUNCTION update_scout_memories_updated_at();
