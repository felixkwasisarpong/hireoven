-- Resume Hub backend support.
-- Safe to run multiple times.

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS file_type TEXT,
  ADD COLUMN IF NOT EXISTS parse_error TEXT,
  ADD COLUMN IF NOT EXISTS github_url TEXT,
  ADD COLUMN IF NOT EXISTS certifications JSONB,
  ADD COLUMN IF NOT EXISTS ats_score INTEGER,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE resumes
  ALTER COLUMN file_url DROP NOT NULL,
  ALTER COLUMN storage_path DROP NOT NULL;

CREATE TABLE IF NOT EXISTS resume_versions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  name TEXT,
  file_url TEXT,
  snapshot JSONB,
  changes_summary TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_versions_unique_number
  ON resume_versions(resume_id, version_number);

CREATE INDEX IF NOT EXISTS idx_resume_versions_user_resume_created
  ON resume_versions(user_id, resume_id, created_at DESC);

CREATE TABLE IF NOT EXISTS resume_tailoring_analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  job_title TEXT,
  company TEXT,
  job_description TEXT NOT NULL,
  match_score INTEGER NOT NULL,
  present_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  missing_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
  suggested_summary_rewrite TEXT,
  suggested_skills_to_add TEXT[] DEFAULT ARRAY[]::TEXT[],
  bullet_suggestions JSONB DEFAULT '[]'::jsonb,
  warnings TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resume_tailoring_user_resume_created
  ON resume_tailoring_analyses(user_id, resume_id, created_at DESC);

CREATE TABLE IF NOT EXISTS resume_ai_edits (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  resume_id UUID REFERENCES resumes(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL,
  label TEXT,
  input_snapshot JSONB,
  output_patch JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resume_ai_edits_user_resume_created
  ON resume_ai_edits(user_id, resume_id, created_at DESC);

ALTER TABLE resume_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_tailoring_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE resume_ai_edits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_versions'
      AND policyname = 'Users manage own resume versions'
  ) THEN
    CREATE POLICY "Users manage own resume versions"
      ON resume_versions FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_tailoring_analyses'
      AND policyname = 'Users manage own tailoring analyses'
  ) THEN
    CREATE POLICY "Users manage own tailoring analyses"
      ON resume_tailoring_analyses FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'resume_ai_edits'
      AND policyname = 'Users manage own AI edits'
  ) THEN
    CREATE POLICY "Users manage own AI edits"
      ON resume_ai_edits FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
