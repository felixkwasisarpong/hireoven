-- Persist domain_score (industry-domain fit, 0–100) from the fast scorer.
-- Surfaced in the job detail right-side panel as "Industry Exp." Was
-- previously computed each tick but discarded — making it impossible to
-- show on cached score hits or to filter/sort on industry fit later.

ALTER TABLE job_match_scores
  ADD COLUMN IF NOT EXISTS domain_score INTEGER;
