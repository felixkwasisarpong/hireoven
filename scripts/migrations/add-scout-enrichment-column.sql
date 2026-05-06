-- Add scout_enrichment JSONB to companies so the Chrome extension can store
-- per-source enrichment signals (Glassdoor rating, LinkedIn headcount, etc.)
-- without polluting raw_ats_config.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS scout_enrichment jsonb NOT NULL DEFAULT '{}';
