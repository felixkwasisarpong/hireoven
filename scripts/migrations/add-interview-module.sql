-- =============================================================
-- Interview module
-- =============================================================

-- enums
CREATE TYPE interview_type AS ENUM ('text', 'live', 'coding');

CREATE TYPE interview_persona AS ENUM (
  'friendly_recruiter',
  'skeptical_hm',
  'senior_staff',
  'founder',
  'panel'
);

CREATE TYPE interview_question_set AS ENUM (
  'behavioral',
  'technical_screen',
  'system_design',
  'coding',
  'mixed'
);

CREATE TYPE interview_status AS ENUM ('setup', 'active', 'completed', 'abandoned');

CREATE TYPE interview_turn_role AS ENUM ('interviewer', 'candidate', 'system');

CREATE TYPE coding_difficulty AS ENUM ('easy', 'medium', 'hard');

CREATE TYPE coding_language AS ENUM ('python', 'javascript', 'typescript', 'any');

-- =============================================================
-- interview_sessions
-- =============================================================
CREATE TABLE interview_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id               UUID REFERENCES jobs(id) ON DELETE SET NULL,
  type                 interview_type NOT NULL,
  persona              interview_persona NOT NULL DEFAULT 'friendly_recruiter',
  question_set         interview_question_set NOT NULL DEFAULT 'behavioral',
  status               interview_status NOT NULL DEFAULT 'setup',
  duration_target_min  INT NOT NULL DEFAULT 30,
  use_resume_context   BOOLEAN NOT NULL DEFAULT TRUE,
  started_at           TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interview_sessions_user_id ON interview_sessions(user_id);
CREATE INDEX idx_interview_sessions_job_id ON interview_sessions(job_id);
CREATE INDEX idx_interview_sessions_status ON interview_sessions(status);
CREATE INDEX idx_interview_sessions_user_created ON interview_sessions(user_id, created_at DESC);

-- =============================================================
-- interview_turns
-- =============================================================
CREATE TABLE interview_turns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  turn_index       INT NOT NULL,
  role             interview_turn_role NOT NULL,
  content          TEXT NOT NULL,
  audio_url        TEXT,
  video_thumb_url  TEXT,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, turn_index)
);

CREATE INDEX idx_interview_turns_session ON interview_turns(session_id, turn_index);

-- =============================================================
-- interview_debriefs
-- =============================================================
CREATE TABLE interview_debriefs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id               UUID NOT NULL UNIQUE REFERENCES interview_sessions(id) ON DELETE CASCADE,
  overall_score            INT CHECK (overall_score BETWEEN 0 AND 100),
  headline                 TEXT,
  strengths                JSONB NOT NULL DEFAULT '[]'::jsonb,
  gaps                     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sample_better_answers    JSONB NOT NULL DEFAULT '[]'::jsonb,
  voice_feedback           JSONB,
  delivery_signals         JSONB,
  coding_feedback          JSONB,
  recommended_next         JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_interview_debriefs_session ON interview_debriefs(session_id);

-- =============================================================
-- coding_problems
-- =============================================================
CREATE TABLE coding_problems (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  difficulty          coding_difficulty NOT NULL,
  language            coding_language NOT NULL DEFAULT 'any',
  prompt              TEXT NOT NULL,
  function_signature  JSONB NOT NULL,
  hidden_tests        JSONB NOT NULL,
  hints               JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_minutes      INT NOT NULL DEFAULT 30,
  tags                TEXT[] NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coding_problems_difficulty ON coding_problems(difficulty);
CREATE INDEX idx_coding_problems_tags ON coding_problems USING GIN(tags);

-- =============================================================
-- coding_attempts
-- =============================================================
CREATE TABLE coding_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  problem_id      UUID NOT NULL REFERENCES coding_problems(id),
  language_used   coding_language NOT NULL,
  code_snapshots  JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_code      TEXT,
  test_results    JSONB,
  hints_used      INT NOT NULL DEFAULT 0,
  solve_time_sec  INT,
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_coding_attempts_session ON coding_attempts(session_id);
CREATE INDEX idx_coding_attempts_problem ON coding_attempts(problem_id);

-- =============================================================
-- updated_at trigger for interview_sessions
-- =============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_interview_sessions_updated_at'
  ) THEN
    CREATE TRIGGER trg_interview_sessions_updated_at
      BEFORE UPDATE ON interview_sessions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END$$;
