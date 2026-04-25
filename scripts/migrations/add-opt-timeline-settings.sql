-- Add nullable settings payload for the OPT/STEM OPT timeline dashboard.
-- Calculations stay in application code so users can manually override dates/counts.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS opt_timeline_settings JSONB;
