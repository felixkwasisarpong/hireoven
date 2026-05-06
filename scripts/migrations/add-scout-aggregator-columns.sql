-- Scout aggregator dedupe + enrichment support.
--
-- Adds the columns the new /api/scout/jobs/ingest and /api/scout/companies/enrich
-- routes need, plus an index for source-id lookups.

BEGIN;

-- jobs.posted_at — canonical posting timestamp pulled from the page. Used for
-- LinkedIn fallback dedupe (title + day) and Indeed's "keep earliest post"
-- rule. Existing rows without this value will keep raw_data.postedAt as the
-- soft fallback.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS posted_at timestamptz;

CREATE INDEX IF NOT EXISTS jobs_posted_at_idx
  ON public.jobs (posted_at);

-- Source-id lookup index for the per-aggregator dedupe path. We're storing
-- scoutSource / scoutSourceId in raw_data for now; if usage grows we should
-- promote these to first-class columns and migrate the index.
CREATE INDEX IF NOT EXISTS jobs_scout_source_idx
  ON public.jobs (
    company_id,
    (raw_data ->> 'scoutSource'),
    (raw_data ->> 'scoutSourceId')
  );

-- companies.scout_enrichment — namespaced bag of per-source enrichment payloads
-- (rating, reviewCount, ceoApproval, recommendToFriend, pros[], cons[], etc.)
-- written by /api/scout/companies/enrich. Keyed by source ('glassdoor', etc.)
-- so multiple sources can coexist.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS scout_enrichment jsonb DEFAULT '{}'::jsonb;

COMMIT;
