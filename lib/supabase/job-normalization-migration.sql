-- Optional migration for dedicated normalization storage.
-- Current runtime remains backward compatible by storing this in jobs.raw_data.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS normalization_version TEXT,
  ADD COLUMN IF NOT EXISTS normalization_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS normalization_completeness NUMERIC,
  ADD COLUMN IF NOT EXISTS normalization_requires_review BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS job_normalizations (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  schema_version TEXT NOT NULL,
  source_adapter TEXT NOT NULL,
  canonical_payload JSONB NOT NULL,
  page_view_payload JSONB NOT NULL,
  card_view_payload JSONB NOT NULL,
  confidence_score NUMERIC NOT NULL,
  completeness_score NUMERIC NOT NULL,
  requires_review BOOLEAN NOT NULL DEFAULT false,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_normalizations_source_adapter
  ON job_normalizations(source_adapter);

CREATE INDEX IF NOT EXISTS idx_job_normalizations_requires_review
  ON job_normalizations(requires_review);

CREATE INDEX IF NOT EXISTS idx_job_normalizations_confidence
  ON job_normalizations(confidence_score DESC);
