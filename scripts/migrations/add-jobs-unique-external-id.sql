-- Required for the harvester's bulk ON CONFLICT upsert path.
-- The existing per-row SELECT-then-INSERT-or-UPDATE pattern in persist.ts never
-- relied on a constraint, so there's no guarantee a few historical duplicates
-- don't exist. Dedup first, then add the constraint.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY company_id, external_id
           ORDER BY updated_at DESC NULLS LAST,
                    last_seen_at DESC NULLS LAST,
                    created_at DESC NULLS LAST,
                    id
         ) AS rn
  FROM jobs
  WHERE external_id IS NOT NULL
    AND company_id IS NOT NULL
)
DELETE FROM jobs
USING ranked
WHERE jobs.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS jobs_company_external_id_uq
  ON jobs (company_id, external_id)
  WHERE external_id IS NOT NULL
    AND company_id IS NOT NULL;
