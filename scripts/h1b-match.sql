-- h1b-match.sql
-- Three-pass employer name matching: h1b_records + employer_lca_stats → companies
--
-- Pass 1: exact normalized name match (strip legal suffixes + punctuation)
-- Pass 2: exact match after also stripping geographic/regional modifiers
-- Pass 3: trigram similarity ≥ 0.55 WITH prefix guard (one name is a prefix of the other)
--         Only for employers with ≥ 10 petitions to avoid noise on tiny records.
-- Finally rolls up H1B sponsorship stats onto companies table.
--
-- Usage: psql <connection-string> -f scripts/h1b-match.sql

BEGIN;

-- ─── Normalization functions ──────────────────────────────────────────────────

-- Strip legal entity suffixes then remove punctuation
CREATE OR REPLACE FUNCTION normalize_employer_name(txt TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(
    regexp_replace(
      regexp_replace(
        lower(trim(coalesce(txt, ''))),
        '\s+(inc\.?|corp\.?|llc\.?|l\.l\.c\.?|ltd\.?|lp\.?|l\.p\.?|llp\.?|l\.l\.p\.?|co\.?|plc\.?|p\.c\.?|pllc\.?|na\.?|pc\.?|incorporated|corporation|company|limited|holdings|holding|group)\s*$',
        '', 'gi'
      ),
      '[^a-z0-9 ]', '', 'g'
    )
  )
$$;

-- Also strip trailing geographic/org qualifiers (e.g. "oracle america" → "oracle")
CREATE OR REPLACE FUNCTION normalize_employer_name_ext(txt TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT trim(
    regexp_replace(
      normalize_employer_name(txt),
      '\s+(us|usa|america|americas|global|international|worldwide|north america|united states|canada|uk)\s*$',
      '', 'gi'
    )
  )
$$;

-- ─── Canonical company lookup table ──────────────────────────────────────────
-- Excludes placeholder/stub domains; one row per normalized name, preferring
-- real-domain records over builtin-discovery stubs.

CREATE TEMP TABLE canonical_companies AS
SELECT DISTINCT ON (normalize_employer_name(name))
  id,
  name,
  domain,
  normalize_employer_name(name)     AS name_norm,
  normalize_employer_name_ext(name) AS name_norm_ext
FROM companies
WHERE domain NOT LIKE '%-placeholder%'
  AND domain NOT LIKE '%-discovered%'
  AND domain NOT LIKE 'builtin-%'
  AND domain NOT LIKE 'adzuna-%'
  AND domain NOT LIKE 'dice-%'
  AND domain NOT LIKE 'workable-%'
  AND char_length(normalize_employer_name(name)) >= 4
ORDER BY
  normalize_employer_name(name),
  CASE WHEN domain LIKE '%.builtin-discovery' THEN 1 ELSE 0 END ASC,
  name ASC;

CREATE INDEX cc_norm_idx     ON canonical_companies (name_norm);
CREATE INDEX cc_norm_ext_idx ON canonical_companies (name_norm_ext);
CREATE INDEX cc_trgm_idx     ON canonical_companies USING gin (name_norm gin_trgm_ops);

\echo 'canonical_companies built'

-- ─── H1B Pass 1: exact normalized match ──────────────────────────────────────

UPDATE h1b_records h
SET company_id = c.id
FROM canonical_companies c
WHERE h.company_id IS NULL
  AND normalize_employer_name(h.employer_name) = c.name_norm
  AND char_length(normalize_employer_name(h.employer_name)) >= 4;

\echo 'H1B pass 1 (exact) done'

-- ─── H1B Pass 2: geo-stripped exact match ─────────────────────────────────────
-- "COGNIZANT TECHNOLOGY SOLUTIONS US CORP" → ext "cognizant technology solutions" ✓
-- "ORACLE AMERICA INC" → ext "oracle" ✓

UPDATE h1b_records h
SET company_id = c.id
FROM canonical_companies c
WHERE h.company_id IS NULL
  AND normalize_employer_name_ext(h.employer_name) = c.name_norm
  AND char_length(normalize_employer_name_ext(h.employer_name)) >= 4;

\echo 'H1B pass 2 (geo-stripped exact) done'

-- ─── H1B Pass 3: trigram + prefix guard ──────────────────────────────────────
-- Prefix guard ensures one name is a prefix of the other, preventing false
-- matches between generic names ("uber technologies" vs "tyler technologies").

SET pg_trgm.similarity_threshold = 0.55;

CREATE TEMP TABLE unmatched_h1b AS
SELECT
  employer_name,
  normalize_employer_name(employer_name)     AS emp_norm,
  normalize_employer_name_ext(employer_name) AS emp_norm_ext
FROM h1b_records
WHERE company_id IS NULL
GROUP BY employer_name
HAVING SUM(total_petitions) >= 10;

CREATE INDEX uh_trgm_idx     ON unmatched_h1b USING gin (emp_norm gin_trgm_ops);
CREATE INDEX uh_trgm_ext_idx ON unmatched_h1b USING gin (emp_norm_ext gin_trgm_ops);

-- Best match: try basic norm first, then ext norm; require prefix relationship
CREATE TEMP TABLE h1b_trgm_matches AS
SELECT DISTINCT ON (u.employer_name)
  u.employer_name,
  m.company_id,
  m.sim
FROM unmatched_h1b u
CROSS JOIN LATERAL (
  SELECT cc.id AS company_id, similarity(u.emp_norm, cc.name_norm) AS sim
  FROM canonical_companies cc
  WHERE u.emp_norm % cc.name_norm
    AND (
      u.emp_norm LIKE cc.name_norm || '%'
      OR cc.name_norm LIKE u.emp_norm || '%'
      OR u.emp_norm_ext LIKE cc.name_norm || '%'
      OR cc.name_norm LIKE u.emp_norm_ext || '%'
    )
  ORDER BY sim DESC
  LIMIT 1
) m
ORDER BY u.employer_name, m.sim DESC;

UPDATE h1b_records h
SET company_id = m.company_id
FROM h1b_trgm_matches m
WHERE h.employer_name = m.employer_name
  AND h.company_id IS NULL;

\echo 'H1B pass 3 (trigram + prefix) done'

-- ─── LCA stats: same three passes ─────────────────────────────────────────────

-- Pass 1: exact
UPDATE employer_lca_stats e
SET company_id = c.id
FROM canonical_companies c
WHERE e.company_id IS NULL
  AND normalize_employer_name(e.employer_name_normalized) = c.name_norm
  AND char_length(normalize_employer_name(e.employer_name_normalized)) >= 4;

-- Pass 2: geo-stripped exact
UPDATE employer_lca_stats e
SET company_id = c.id
FROM canonical_companies c
WHERE e.company_id IS NULL
  AND normalize_employer_name_ext(e.employer_name_normalized) = c.name_norm
  AND char_length(normalize_employer_name_ext(e.employer_name_normalized)) >= 4;

-- Pass 3: trgm + prefix (815 rows total, LATERAL is fast enough)
UPDATE employer_lca_stats e
SET company_id = best.company_id
FROM (
  SELECT DISTINCT ON (e2.id)
    e2.id,
    cc.company_id,
    cc.sim
  FROM employer_lca_stats e2
  CROSS JOIN LATERAL (
    SELECT cc2.id AS company_id,
      similarity(normalize_employer_name_ext(e2.employer_name_normalized), cc2.name_norm) AS sim
    FROM canonical_companies cc2
    WHERE normalize_employer_name_ext(e2.employer_name_normalized) % cc2.name_norm
      AND (
        normalize_employer_name_ext(e2.employer_name_normalized) LIKE cc2.name_norm || '%'
        OR cc2.name_norm LIKE normalize_employer_name_ext(e2.employer_name_normalized) || '%'
      )
    ORDER BY sim DESC
    LIMIT 1
  ) cc
  WHERE e2.company_id IS NULL
  ORDER BY e2.id, cc.sim DESC
) best
WHERE e.id = best.id;

\echo 'LCA matching done'

-- ─── Roll up H1B stats into companies ────────────────────────────────────────
--
-- sponsors_h1b          = had ≥1 approval in last 3 fiscal years (2023+)
-- h1b_sponsor_count_1yr = total approvals in 2025-2026
-- h1b_sponsor_count_3yr = total approvals in 2023-2026
-- sponsorship_confidence = 0-100 integer, log-scale on recent 1yr approvals

UPDATE companies co
SET
  sponsors_h1b          = (stats.approved_3yr > 0),
  h1b_sponsor_count_1yr = stats.approved_1yr,
  h1b_sponsor_count_3yr = stats.approved_3yr,
  sponsorship_confidence = CASE
    WHEN stats.approved_3yr <= 0 THEN 0
    WHEN stats.approved_1yr <= 0 THEN 30   -- only older history (2023-2024)
    WHEN stats.approved_1yr < 2  THEN 50
    WHEN stats.approved_1yr < 5  THEN 60
    WHEN stats.approved_1yr < 10 THEN 68
    WHEN stats.approved_1yr < 20 THEN 75
    WHEN stats.approved_1yr < 50 THEN 82
    WHEN stats.approved_1yr < 100 THEN 88
    WHEN stats.approved_1yr < 200 THEN 92
    ELSE 95
  END
FROM (
  SELECT
    company_id,
    SUM(CASE WHEN year >= 2025 THEN approved ELSE 0 END)::int AS approved_1yr,
    SUM(CASE WHEN year >= 2023 THEN approved ELSE 0 END)::int AS approved_3yr
  FROM h1b_records
  WHERE company_id IS NOT NULL
  GROUP BY company_id
) stats
WHERE co.id = stats.company_id;

\echo 'Company sponsorship rollup done'

-- ─── Summary ──────────────────────────────────────────────────────────────────

SELECT
  'h1b_records matched' AS label,
  COUNT(*) FILTER (WHERE company_id IS NOT NULL) AS matched,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE company_id IS NOT NULL) / COUNT(*), 1) AS pct
FROM h1b_records
UNION ALL
SELECT
  'employer_lca_stats matched',
  COUNT(*) FILTER (WHERE company_id IS NOT NULL),
  COUNT(*),
  ROUND(100.0 * COUNT(*) FILTER (WHERE company_id IS NOT NULL) / COUNT(*), 1)
FROM employer_lca_stats
UNION ALL
SELECT
  'companies with sponsors_h1b=true',
  COUNT(*) FILTER (WHERE sponsors_h1b = true),
  COUNT(*),
  ROUND(100.0 * COUNT(*) FILTER (WHERE sponsors_h1b = true) / COUNT(*), 1)
FROM companies;

COMMIT;
