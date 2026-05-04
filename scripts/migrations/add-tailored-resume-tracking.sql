-- add-tailored-resume-tracking.sql
--
-- Adds per-job tailored resume tracking to the `resumes` table.
-- A tailored resume is a separate `resumes` row (NOT a row in resume_versions —
-- those track edit history of one resume; tailored copies are independent
-- resumes the user can pick from in autofill / dashboards).
--
-- Columns:
--   parent_resume_id      → the resume this was tailored from
--   tailored_for_job_id   → the saved jobs.id this resume was tailored for
--   tailored_for_company  → cached company name (denormalized for display
--                           when the joined company row is unavailable)
--   tailored_for_role     → cached job title at time of tailor
--
-- Indexes:
--   - (user_id, tailored_for_job_id) so the autofill download endpoint can
--     look up "tailored copy for this user + this job" in one shot
--   - (user_id, parent_resume_id) for grouping copies under their parent
--
-- Safe to re-run.

BEGIN;

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS parent_resume_id     UUID REFERENCES resumes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tailored_for_job_id  UUID REFERENCES jobs(id)    ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tailored_for_company TEXT,
  ADD COLUMN IF NOT EXISTS tailored_for_role    TEXT;

CREATE INDEX IF NOT EXISTS idx_resumes_user_tailored_job
  ON resumes (user_id, tailored_for_job_id)
  WHERE tailored_for_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_resumes_user_parent
  ON resumes (user_id, parent_resume_id)
  WHERE parent_resume_id IS NOT NULL;

COMMIT;
