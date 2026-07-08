-- fix-h1b-substring-mislinks.sql
--
-- Reverses the substring-containment matching bug in lib/h1b/uscis-parser.ts
-- (fuzzyMatch used `a.includes(b) || b.includes(a)` with no word-boundary or
-- length guard). Short normalized company names — "ati" (Ati Holdings LLC),
-- "arm", "arch", "mat", "soci" — swallowed thousands of unrelated H-1B employers
-- whose names merely *contained* that substring (communic-ATI-ons, ph-ARM-a,
-- infor-MAT-ion), inflating companies.h1b_sponsor_count_* and wrongly flagging
-- sponsors_h1b = true on the public leaderboard.
--
-- This script:
--   1. Unlinks h1b_records that were linked ONLY via the buggy raw-substring
--      branch and fail the new whole-word rule (mirrors the fixed fuzzyMatch).
--      Legit exact / levenshtein / spacing matches (Avisbudget <-> "AVIS BUDGET",
--      Faraday & Future <-> "FARADAY AND FUTURE") are left untouched.
--   2. Recomputes the denormalized company sponsorship fields for exactly the
--      affected companies, mirroring choosePatch() in
--      scripts/recompute-company-h1b-scores.ts.
--
-- Usage:
--   Dry run (rolls back, prints impact):
--     psql "$DATABASE_URL" -v do_commit=false -f scripts/fix-h1b-substring-mislinks.sql
--   Execute:
--     psql "$DATABASE_URL" -v do_commit=true  -f scripts/fix-h1b-substring-mislinks.sql
--   Then refresh the leaderboard:
--     psql "$DATABASE_URL" -c "REFRESH MATERIALIZED VIEW h1b_leaderboard_mv;"

\set ON_ERROR_STOP on
BEGIN;

-- ── Normalization: mirror lib/h1b/normalize-employer.ts ──────────────────────
CREATE OR REPLACE FUNCTION pg_temp.norm_emp(txt text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(txt, '')), '[.,]', ' ', 'g'),
        '\y(incorporated|inc|llc|l\.l\.c|corp|corporation|ltd|limited|co|company|plc|holdings|group|technologies|technology|systems|solutions|services)\y', '', 'g'),
      '[^a-z0-9& ]+', ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Whole-word containment with a length floor >= 4: mirrors the fixed
-- containsAsPhrase(). Normalized names contain only [a-z0-9& ] so no escaping.
CREATE OR REPLACE FUNCTION pg_temp.wword_contains(hay text, needle text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT length(needle) >= 4 AND (hay = needle OR hay ~ ('(^| )' || needle || '( |$)'))
$$;

-- ── Identify the substring-branch false positives ────────────────────────────
CREATE TEMP TABLE bad_links ON COMMIT DROP AS
SELECT h.id, h.company_id
FROM h1b_records h
JOIN companies c ON c.id = h.company_id
CROSS JOIN LATERAL (
  SELECT pg_temp.norm_emp(h.employer_name) AS emp, pg_temp.norm_emp(c.name) AS comp
) n
WHERE n.comp <> '' AND n.emp <> ''
  -- linked via the OLD buggy raw-substring branch...
  AND (position(n.comp IN n.emp) > 0 OR position(n.emp IN n.comp) > 0)
  -- ...but fails the NEW whole-word rule
  AND NOT (n.emp = n.comp
           OR pg_temp.wword_contains(n.emp, n.comp)
           OR pg_temp.wword_contains(n.comp, n.emp));

CREATE TEMP TABLE affected_companies ON COMMIT DROP AS
SELECT DISTINCT company_id AS id FROM bad_links;

\echo '── impact ──'
SELECT (SELECT count(*) FROM bad_links)                AS rows_to_unlink,
       (SELECT count(*) FROM affected_companies)       AS companies_affected;

-- ── 1. Unlink ────────────────────────────────────────────────────────────────
UPDATE h1b_records SET company_id = NULL
WHERE id IN (SELECT id FROM bad_links);

-- ── 2. Recompute denorm for affected companies (mirrors choosePatch) ─────────
-- USCIS snapshot: approvals + total at each company's latest linked year.
WITH uscis_latest_year AS (
  SELECT company_id, max(year) AS latest_year
  FROM h1b_records
  WHERE company_id IN (SELECT id FROM affected_companies)
  GROUP BY company_id
),
uscis AS (
  SELECT h.company_id,
         sum(h.approved)                 AS approvals,
         sum(h.approved + h.denied)      AS total
  FROM h1b_records h
  JOIN uscis_latest_year y ON y.company_id = h.company_id AND h.year = y.latest_year
  GROUP BY h.company_id
),
-- LCA per-year certified (from employer_lca_stats.stats_by_year)
lca_year AS (
  SELECT e.company_id, (j.key)::int AS year,
         sum(coalesce((j.value->>'certified')::numeric, 0)) AS certified
  FROM employer_lca_stats e
  CROSS JOIN LATERAL jsonb_each(coalesce(e.stats_by_year, '{}'::jsonb)) j
  WHERE e.company_id IN (SELECT id FROM affected_companies)
    AND j.key ~ '^[0-9]+$'
  GROUP BY e.company_id, (j.key)::int
),
lca_tot AS (
  SELECT company_id,
         sum(total_certified) AS total_certified,
         sum(total_denied)    AS total_denied
  FROM employer_lca_stats
  WHERE company_id IN (SELECT id FROM affected_companies)
  GROUP BY company_id
),
lca AS (
  SELECT t.company_id,
         coalesce((SELECT ly.certified FROM lca_year ly
                   WHERE ly.company_id = t.company_id
                   ORDER BY ly.year DESC LIMIT 1), 0)                      AS cert1y,
         coalesce((SELECT sum(s.certified) FROM (
                     SELECT ly.certified FROM lca_year ly
                     WHERE ly.company_id = t.company_id
                     ORDER BY ly.year DESC LIMIT 3) s), 0)                 AS cert3y,
         t.total_certified, t.total_denied
  FROM lca_tot t
),
patch AS (
  SELECT a.id AS company_id,
         u.approvals, u.total,
         l.cert1y, l.cert3y, l.total_certified, l.total_denied
  FROM affected_companies a
  LEFT JOIN uscis u ON u.company_id = a.id
  LEFT JOIN lca   l ON l.company_id = a.id
),
final AS (
  SELECT company_id,
    CASE
      WHEN coalesce(total,0) > 0 THEN coalesce(approvals,0)
      WHEN coalesce(total_certified,0)+coalesce(total_denied,0) > 0
           OR coalesce(cert1y,0) > 0 OR coalesce(cert3y,0) > 0 THEN coalesce(cert1y,0)
      ELSE 0
    END AS count_1yr,
    CASE
      WHEN coalesce(total,0) > 0 THEN coalesce(cert3y,0)
      WHEN coalesce(total_certified,0)+coalesce(total_denied,0) > 0
           OR coalesce(cert1y,0) > 0 OR coalesce(cert3y,0) > 0 THEN coalesce(cert3y,0)
      ELSE 0
    END AS count_3yr,
    CASE
      WHEN coalesce(total,0) > 0
        THEN (coalesce(approvals,0) > 0 OR coalesce(cert3y,0) > 0)
      WHEN coalesce(total_certified,0)+coalesce(total_denied,0) > 0
           OR coalesce(cert1y,0) > 0 OR coalesce(cert3y,0) > 0
        THEN (coalesce(cert1y,0) > 0 OR coalesce(cert3y,0) > 0)
      ELSE false
    END AS sponsors,
    CASE
      WHEN coalesce(total,0) > 0 THEN
        least(100,
          (CASE WHEN coalesce(approvals,0) > 0 THEN 70 ELSE 0 END)
        + (CASE WHEN total > 0 AND approvals::numeric/total > 0.8 THEN 10 ELSE 0 END)
        + (CASE WHEN coalesce(approvals,0) > 10 THEN 10 ELSE 0 END)
        + (CASE WHEN coalesce(approvals,0) > 50 THEN 10 ELSE 0 END))
      WHEN coalesce(total_certified,0)+coalesce(total_denied,0) > 0
           OR coalesce(cert1y,0) > 0 OR coalesce(cert3y,0) > 0 THEN
        least(100,
          (CASE WHEN coalesce(cert1y,0) > 0 THEN 70 ELSE 0 END)
        + (CASE WHEN (coalesce(total_certified,0)+coalesce(total_denied,0)) > 0
                 AND total_certified::numeric/(total_certified+total_denied) > 0.85 THEN 10 ELSE 0 END)
        + (CASE WHEN coalesce(cert1y,0) > 10 THEN 10 ELSE 0 END)
        + (CASE WHEN coalesce(cert1y,0) > 50 THEN 10 ELSE 0 END))
      ELSE 0
    END AS confidence
  FROM patch
)
UPDATE companies c
SET h1b_sponsor_count_1yr = f.count_1yr,
    h1b_sponsor_count_3yr = f.count_3yr,
    sponsors_h1b          = f.sponsors,
    sponsorship_confidence = f.confidence
FROM final f
WHERE c.id = f.company_id;

-- ── verification ─────────────────────────────────────────────────────────────
\echo '── sample affected companies after recompute ──'
SELECT c.name, c.domain, c.sponsors_h1b, c.sponsorship_confidence,
       c.h1b_sponsor_count_1yr, c.h1b_sponsor_count_3yr,
       (SELECT count(DISTINCT employer_name) FROM h1b_records h WHERE h.company_id = c.id) AS linked_employers
FROM companies c
WHERE c.id IN (SELECT id FROM affected_companies)
ORDER BY c.h1b_sponsor_count_1yr DESC
LIMIT 15;

\if :do_commit
  COMMIT;
  \echo '── COMMITTED ──'
\else
  ROLLBACK;
  \echo '── ROLLED BACK (dry run) ──'
\endif
