-- backfill-extension-scout-company-names.sql
--
-- One-off cleanup for `job_applications` rows saved via the Scout extension
-- where company_name was either:
--   1. Left as the literal string 'Unknown Company' (pre-fix default)
--   2. Set to an ATS provider name ('Greenhouse', 'Lever', 'Ashbyhq', 'Linkedin',
--      'Indeed', 'Glassdoor', 'Myworkdayjobs', 'Workdayjobs') by the buggy
--      URL-host fallback before the ATS-aware fix landed.
--
-- Strategy:
--   - Only touch rows where source = 'extension-scout'
--   - Only touch rows where company_name IS NULL OR matches the bad set above
--   - For each row, derive the correct name from apply_url using the same rules
--     as the new save route (ATS-host → path segment, Workday → subdomain,
--     known job boards → leave NULL, branded → host root title-cased)
--   - If we can't safely derive one, leave it NULL (better than a wrong value)
--
-- Safe to re-run: idempotent. Skips rows where company_name is already a real
-- value (i.e. not in the bad set).
--
-- Run with:
--   psql "$DATABASE_URL" -f scripts/migrations/backfill-extension-scout-company-names.sql

BEGIN;

-- Show what's about to change (dry-run summary).
\echo
\echo 'Before — rows that will be considered:'
SELECT
  source,
  COALESCE(company_name, '<NULL>') AS current_value,
  COUNT(*) AS rows
FROM job_applications
WHERE source IN ('extension', 'extension-scout')
  AND (
    company_name IS NULL
    OR company_name = ''
    OR company_name IN (
      'Unknown Company',
      'Greenhouse', 'Lever', 'Ashbyhq', 'Linkedin', 'Indeed',
      'Glassdoor', 'Myworkdayjobs', 'Workdayjobs'
    )
  )
GROUP BY source, company_name
ORDER BY rows DESC;

-- Helper: derive a company name from a URL, mirroring the save route's logic.
-- Pure SQL (no plpgsql) to keep it transparent and easy to audit.
WITH derived AS (
  SELECT
    ja.id,
    ja.apply_url,
    ja.company_name AS old_name,
    -- Extract host (no scheme, no www, no path)
    LOWER(REGEXP_REPLACE(
      REGEXP_REPLACE(ja.apply_url, '^https?://(www\.)?', ''),
      '[/?#].*$', ''
    )) AS host,
    -- First non-empty path segment
    NULLIF(
      SPLIT_PART(
        REGEXP_REPLACE(ja.apply_url, '^https?://[^/]+/?', ''),
        '/', 1
      ),
      ''
    ) AS path_seg
  FROM job_applications ja
  WHERE ja.source IN ('extension', 'extension-scout')
    AND (
      ja.company_name IS NULL
      OR ja.company_name = ''
      OR ja.company_name IN (
        'Unknown Company',
        'Greenhouse', 'Lever', 'Ashbyhq', 'Linkedin', 'Indeed',
        'Glassdoor', 'Myworkdayjobs', 'Workdayjobs'
      )
    )
),
named AS (
  SELECT
    id,
    apply_url,
    old_name,
    CASE
      -- Path-segment ATSes
      WHEN host = 'greenhouse.io' OR host LIKE '%.greenhouse.io'
           OR host = 'lever.co' OR host LIKE '%.lever.co'
           OR host = 'ashbyhq.com' OR host LIKE '%.ashbyhq.com'
        THEN path_seg
      -- Subdomain ATS (Workday)
      WHEN host LIKE '%.myworkdayjobs.com' OR host LIKE '%.workdayjobs.com'
        THEN SPLIT_PART(host, '.', 1)
      -- Job boards we can't infer from
      WHEN host LIKE '%linkedin.com' OR host LIKE '%indeed.com' OR host LIKE '%glassdoor.com'
        THEN NULL
      -- Branded careers page: registrable domain root
      ELSE SPLIT_PART(host, '.', GREATEST(REGEXP_COUNT(host, '\.') - 0, 1))
    END AS raw_slug
  FROM derived
),
titled AS (
  SELECT
    id,
    apply_url,
    old_name,
    CASE
      WHEN raw_slug IS NULL OR raw_slug = '' THEN NULL
      ELSE INITCAP(REGEXP_REPLACE(raw_slug, '[-_+]', ' ', 'g'))
    END AS new_name
  FROM named
)
UPDATE job_applications ja
SET
  company_name = t.new_name,
  updated_at = NOW()
FROM titled t
WHERE ja.id = t.id
  AND t.new_name IS NOT NULL
  AND t.new_name <> COALESCE(ja.company_name, '');

\echo
\echo 'After — verify nothing bad remains:'
SELECT
  source,
  COALESCE(company_name, '<NULL>') AS company_name,
  COUNT(*) AS rows
FROM job_applications
WHERE source IN ('extension', 'extension-scout')
  AND (
    company_name IS NULL
    OR company_name IN (
      'Unknown Company',
      'Greenhouse', 'Lever', 'Ashbyhq', 'Linkedin', 'Indeed',
      'Glassdoor', 'Myworkdayjobs', 'Workdayjobs'
    )
  )
GROUP BY source, company_name
ORDER BY rows DESC;

-- Backfill jobs.company_id for rows where the company exists in `companies`
-- but the foreign key wasn't set on the original save. Done via subquery to
-- avoid Postgres' "table cannot be referenced from this part of the query"
-- error when chaining JOINs in an UPDATE FROM clause.
\echo
\echo 'Linking jobs.company_id by company_name match:'
UPDATE jobs j
SET company_id = c.id,
    updated_at = NOW()
FROM companies c
WHERE j.company_id IS NULL
  AND j.id IN (
    SELECT ja.job_id
    FROM job_applications ja
    WHERE ja.source IN ('extension', 'extension-scout')
      AND ja.company_name IS NOT NULL
      AND LOWER(ja.company_name) = LOWER(c.name)
  );

COMMIT;
