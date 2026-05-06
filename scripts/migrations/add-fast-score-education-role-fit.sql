-- Adds deterministic education + role-fit dimensions to job_match_scores so the
-- fast scorer can power both the job card and the detail panel bars without
-- relying on the LLM-driven resume_analyses fallback.

ALTER TABLE job_match_scores
  ADD COLUMN IF NOT EXISTS education_score INTEGER,
  ADD COLUMN IF NOT EXISTS role_fit_score INTEGER,
  ADD COLUMN IF NOT EXISTS is_education_match BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_role_fit_match BOOLEAN;
