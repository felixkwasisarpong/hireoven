-- Lets a user position their resume toward a chosen career field for matching.
-- target_field holds a FIELDS key from lib/resume/signal (e.g. 'ai_ml',
-- 'fintech'). When set, the fast matcher gives jobs in that field a small,
-- bounded boost so the chosen lane rises up the feed. NULL = no positioning
-- (default matcher behavior). Saving it also touches resumes.updated_at, which
-- bumps the score-cache resume_version so cached matches recompute with it.

ALTER TABLE resumes
  ADD COLUMN IF NOT EXISTS target_field TEXT;
