-- Blog generation moved from a fixed weekday->category schedule to trend-driven
-- topic selection. A quiet news day is now a legitimate outcome: the scout finds
-- nothing genuinely new and the run skips instead of manufacturing a repeat post.
--
-- blog_generation_runs.status has a CHECK constraint listing the allowed values,
-- so recording that outcome fails at runtime until the constraint admits it.
--
-- Safe to re-run.

ALTER TABLE blog_generation_runs
  DROP CONSTRAINT IF EXISTS blog_generation_runs_status_check;

ALTER TABLE blog_generation_runs
  ADD CONSTRAINT blog_generation_runs_status_check
  CHECK (status IN (
    'success',
    'skipped_weekend',
    'skipped_existing',
    'skipped_no_trend',
    'failed'
  ));
