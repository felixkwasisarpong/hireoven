-- Migration: add-lca-wage-aggregates (Spec 06)
-- Wage aggregates from lca_records prevailing wages. KEY CORRECTIONS vs naive spec:
--   * prevailing_wage is mixed-unit — ANNUALIZE before percentiles (Hour x2080, Week x52,
--     Bi-Weekly x26, Month x12, Year x1), then keep a sane annual band 15k-1M.
--   * case_status LIKE 'Certified%' (includes 'Certified - Withdrawn' — both are filed/certified wages).
--   * NO company_id IS NOT NULL filter — role/state aggregates need all ~351k certified filings;
--     unlinked rows fold under a sentinel company_id so the unique index stays NULL-free (needed
--     for REFRESH ... CONCURRENTLY). Company-scoped queries filter out the sentinel.
--   * wage_level is text I/II/III/IV; blank/'N/A' -> 'NA'. state = worksite_state_abbr.
--
-- APPLY:
--   psql "$DATABASE_URL" -f scripts/migrations/add-lca-wage-aggregates.sql
--   psql "$DATABASE_URL" -c "REFRESH MATERIALIZED VIEW lca_wage_aggregates_mv;"   -- first refresh non-concurrent

DROP MATERIALIZED VIEW IF EXISTS lca_wage_aggregates_mv;

CREATE MATERIALIZED VIEW lca_wage_aggregates_mv AS
WITH annualized AS (
  SELECT
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid) AS company_id,
    LEFT(soc_code, 5)                                                   AS soc_group, -- "15-12"
    worksite_state_abbr                                                 AS state,
    COALESCE(NULLIF(NULLIF(TRIM(wage_level), ''), 'N/A'), 'NA')         AS wage_level,
    fiscal_year,
    CASE lower(trim(prevailing_wage_unit))
      WHEN 'hour'      THEN prevailing_wage * 2080
      WHEN 'week'      THEN prevailing_wage * 52
      WHEN 'bi-weekly' THEN prevailing_wage * 26
      WHEN 'month'     THEN prevailing_wage * 12
      ELSE prevailing_wage                                              -- 'year' or unknown: treat as annual
    END                                                                 AS annual_wage
  FROM lca_records
  WHERE case_status LIKE 'Certified%'
    AND prevailing_wage > 0
    AND soc_code IS NOT NULL
    AND worksite_state_abbr IS NOT NULL
    AND fiscal_year >= EXTRACT(YEAR FROM NOW())::int - 4               -- last 5 FYs
)
SELECT
  company_id,
  soc_group,
  state,
  wage_level,
  COUNT(*)                                                         AS n,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY annual_wage)) AS p50_wage,
  ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY annual_wage)) AS p25_wage,
  ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY annual_wage)) AS p75_wage,
  ROUND(MIN(annual_wage))                                          AS min_wage,
  ROUND(MAX(annual_wage))                                          AS max_wage,
  MIN(fiscal_year)                                                 AS min_fy,
  MAX(fiscal_year)                                                 AS max_fy,
  NOW()                                                            AS refreshed_at
FROM annualized
WHERE annual_wage BETWEEN 15000 AND 1000000
GROUP BY company_id, soc_group, state, wage_level;

-- UNIQUE index required for REFRESH ... CONCURRENTLY (all four columns are non-null by construction).
CREATE UNIQUE INDEX lca_wage_agg_dim_uidx
  ON lca_wage_aggregates_mv (company_id, soc_group, state, wage_level);
CREATE INDEX lca_wage_agg_soc_state_idx   ON lca_wage_aggregates_mv (soc_group, state);
CREATE INDEX lca_wage_agg_company_soc_idx ON lca_wage_aggregates_mv (company_id, soc_group);
CREATE INDEX lca_wage_agg_state_idx       ON lca_wage_aggregates_mv (state);
CREATE INDEX lca_wage_agg_soc_idx         ON lca_wage_aggregates_mv (soc_group);

-- SOC group reference (human-readable role labels), seeded in Phase B.
CREATE TABLE IF NOT EXISTS soc_group_labels (
  soc_group   TEXT PRIMARY KEY,        -- "15-12"
  label       TEXT NOT NULL,           -- "Software Developers"
  short_label TEXT NOT NULL,           -- "Software Dev"
  slug        TEXT NOT NULL UNIQUE,    -- "software-developers"
  family      TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS soc_group_labels_slug_idx ON soc_group_labels (slug);
