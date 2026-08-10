-- Adds per-field visa-sponsorship density to the corpus-derived field profiles.
-- sponsor_job_count = how many of the field's jobs are at a sponsoring employer
-- (job says it sponsors, or the company sponsors / has filed H1B in the last yr);
-- sponsorship_share = that count / job_count (0..1). Powers the "visa edge" the
-- positioning page shows when a resume reads across two fields.
-- Refreshed by api/cron/refresh-field-profiles. Requires add-field-skill-profiles.sql.

ALTER TABLE field_skill_profiles
  ADD COLUMN IF NOT EXISTS sponsor_job_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sponsorship_share REAL    NOT NULL DEFAULT 0;
