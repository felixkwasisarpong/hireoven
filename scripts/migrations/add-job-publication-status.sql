-- Separates crawler freshness from user-facing publication.
-- is_active means "still present/live"; publication_status means "safe to show in feeds".

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'published';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_publication_status_check'
      AND conrelid = 'public.jobs'::regclass
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_publication_status_check
      CHECK (publication_status IN ('published', 'pending_enrichment', 'hidden_low_quality'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jobs_publication_active_fresh
  ON public.jobs (publication_status, is_active, first_detected_at DESC NULLS LAST)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_jobs_apex_source_active
  ON public.jobs ((raw_data->>'apexSource'))
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_jobs_capture_source_active
  ON public.jobs ((raw_data->>'captureSource'))
  WHERE is_active = true;

-- Existing low-detail aggregator/LinkedIn shells should not appear in global
-- feeds while their normalizer/enricher is still trying to fetch a real JD.
UPDATE public.jobs
   SET publication_status = 'pending_enrichment',
       updated_at = now()
 WHERE is_active = true
   AND publication_status = 'published'
   AND (
     raw_data->>'captureSource' IN ('apex-aggregator', 'apex-mvp')
     OR raw_data->>'apexSource' IN ('linkedin', 'glassdoor', 'indeed', 'handshake')
   )
   AND length(trim(coalesce(description, ''))) < 120
   AND coalesce(array_length(skills, 1), 0) < 2;
