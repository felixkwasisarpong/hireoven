-- Migration: add-h1b-leaderboard-mv
-- Purpose : Materialized view powering the public H-1B Sponsor Leaderboard (Spec 01).
--           Precomputes per-COMPANY ranks + dynamic latest-3-fiscal-year stats so the
--           web tier (4GB Postgres) serves the leaderboard as keyset lookups, never a
--           live aggregate over employer_lca_stats.
--
-- GRAIN: one row per company_id. employer_lca_stats is keyed by normalized EMPLOYER name,
--        and several name variants can link to the same company (e.g. "TATA CONSULTANCY
--        SERVICES LIMITED" + "Tata Consultancy Services Limited"). We therefore aggregate
--        per company_id — summing numeric totals and MERGING the jsonb stats (stats_by_year,
--        top_states, top_job_titles) — so a company's variants combine instead of producing
--        duplicate rows (which would also break REFRESH ... CONCURRENTLY's unique index).
--
-- Fiscal years are PER-COMPANY and DYNAMIC: latest_fy / prev_fy / prev2_fy are the three
-- most recent year keys present after merging that company's stats_by_year. No hardcoded
-- years — the UI renders the year label from the row.
--
-- APPLY (run manually — repo has no migration runner):
--   psql "$DATABASE_URL" -f scripts/migrations/add-h1b-leaderboard-mv.sql
--   -- CREATE ... AS populates immediately; an extra REFRESH is optional.
--   psql "$DATABASE_URL" -c "SELECT COUNT(*) AS row_count FROM h1b_leaderboard_mv;"
-- The nightly cron (/api/cron/refresh-h1b-leaderboard) runs REFRESH ... CONCURRENTLY,
-- which is allowed because of the UNIQUE index on company_id and keeps reads lock-free.

DROP MATERIALIZED VIEW IF EXISTS h1b_leaderboard_mv;

CREATE MATERIALIZED VIEW h1b_leaderboard_mv AS
WITH els AS (
  SELECT *
  FROM employer_lca_stats
  WHERE company_id IS NOT NULL
),
-- Per-company numeric totals + flags (sum across name variants)
base AS (
  SELECT
    company_id,
    SUM(total_applications)::int AS total_applications,
    SUM(total_certified)::int    AS total_certified,
    SUM(total_denied)::int       AS total_denied,
    SUM(total_withdrawn)::int    AS total_withdrawn,
    bool_or(is_staffing_firm)    AS is_staffing_firm,
    bool_or(is_consulting_firm)  AS is_consulting_firm
  FROM els
  GROUP BY company_id
),
-- Merge stats_by_year across variants → certified per fiscal year, newest first
year_rollup AS (
  SELECT els.company_id, (kv.key)::int AS fy,
         SUM((kv.value->>'certified')::int) AS certified,
         SUM((kv.value->>'total')::int)     AS filed
  FROM els, LATERAL jsonb_each(els.stats_by_year) AS kv
  WHERE kv.key ~ '^\d{4}$'
  GROUP BY els.company_id, (kv.key)::int
),
year_ranked AS (
  SELECT company_id, fy, certified, filed,
         ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY fy DESC) AS rn
  FROM year_rollup
),
year_pivot AS (
  SELECT
    company_id,
    MAX(fy) FILTER (WHERE rn = 1)                          AS latest_fy,
    MAX(fy) FILTER (WHERE rn = 2)                          AS prev_fy,
    MAX(fy) FILTER (WHERE rn = 3)                          AS prev2_fy,
    COALESCE(MAX(certified) FILTER (WHERE rn = 1), 0)::int AS certified_latest_fy,
    COALESCE(MAX(certified) FILTER (WHERE rn = 2), 0)::int AS certified_prev_fy,
    COALESCE(MAX(certified) FILTER (WHERE rn = 3), 0)::int AS certified_prev2_fy,
    COALESCE(MAX(filed) FILTER (WHERE rn = 1), 0)::int     AS filed_latest_fy
  FROM year_ranked
  GROUP BY company_id
),
-- Merge top_states across variants, keep top 10 by combined count
state_rollup AS (
  SELECT els.company_id, (st->>'state') AS state, SUM((st->>'count')::int) AS cnt
  FROM els, LATERAL jsonb_array_elements(els.top_states) AS st
  WHERE NULLIF(st->>'state', '') IS NOT NULL
  GROUP BY els.company_id, (st->>'state')
),
state_agg AS (
  SELECT company_id,
         jsonb_agg(jsonb_build_object('state', state, 'count', cnt) ORDER BY cnt DESC)
           FILTER (WHERE sr <= 10) AS top_states
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY cnt DESC) AS sr
    FROM state_rollup
  ) s
  GROUP BY company_id
),
-- Merge top_job_titles across variants, keep top 10 by combined count
title_rollup AS (
  SELECT els.company_id, (t->>'title') AS title, SUM((t->>'count')::int) AS cnt
  FROM els, LATERAL jsonb_array_elements(els.top_job_titles) AS t
  WHERE NULLIF(t->>'title', '') IS NOT NULL
  GROUP BY els.company_id, (t->>'title')
),
title_agg AS (
  SELECT company_id,
         jsonb_agg(jsonb_build_object('title', title, 'count', cnt) ORDER BY cnt DESC)
           FILTER (WHERE sr <= 10) AS top_job_titles
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY cnt DESC) AS sr
    FROM title_rollup
  ) t
  GROUP BY company_id
),
-- Dominant variant's approval_trend (the largest filer represents the company)
dom AS (
  SELECT DISTINCT ON (company_id) company_id, approval_trend
  FROM els
  ORDER BY company_id, total_applications DESC
),
agg AS (
  SELECT
    c.id                                       AS company_id,
    c.name                                     AS company_name,
    c.domain                                   AS company_domain,
    c.logo_url                                 AS company_logo_url,
    c.industry                                 AS industry,
    c.size                                     AS company_size,
    c.sponsorship_confidence                   AS sponsorship_confidence,
    base.total_applications,
    base.total_certified,
    base.total_denied,
    base.total_withdrawn,
    base.is_staffing_firm,
    base.is_consulting_firm,
    CASE
      WHEN (base.total_certified + base.total_denied) > 0
        THEN ROUND(base.total_certified::numeric / (base.total_certified + base.total_denied), 3)
      ELSE NULL
    END                                        AS certification_rate,
    (
      (base.total_certified + base.total_denied) >= 5
      AND (base.total_certified + base.total_denied) > 0
      AND base.total_certified::numeric / (base.total_certified + base.total_denied) < 0.8
    )                                          AS has_high_denial_rate,
    dom.approval_trend,                        -- 'improving' | 'stable' | 'declining'
    COALESCE(state_agg.top_states, '[]'::jsonb)    AS top_states,
    COALESCE(title_agg.top_job_titles, '[]'::jsonb) AS top_job_titles,
    yp.latest_fy,
    yp.prev_fy,
    yp.prev2_fy,
    COALESCE(yp.certified_latest_fy, 0)        AS certified_latest_fy,
    COALESCE(yp.certified_prev_fy, 0)          AS certified_prev_fy,
    COALESCE(yp.certified_prev2_fy, 0)         AS certified_prev2_fy,
    COALESCE(yp.filed_latest_fy, 0)            AS filed_latest_fy,
    CASE
      WHEN COALESCE(yp.certified_prev_fy, 0) > 0
        THEN ROUND(
          ((COALESCE(yp.certified_latest_fy, 0) - yp.certified_prev_fy)::numeric
            / yp.certified_prev_fy) * 100, 1)
      ELSE NULL
    END                                        AS yoy_change_pct
  FROM base
  JOIN companies c        ON c.id = base.company_id
  LEFT JOIN year_pivot yp ON yp.company_id = base.company_id
  LEFT JOIN state_agg     ON state_agg.company_id = base.company_id
  LEFT JOIN title_agg     ON title_agg.company_id = base.company_id
  LEFT JOIN dom           ON dom.company_id = base.company_id
  WHERE base.total_applications >= 5
    AND c.is_active = true
)
SELECT
  agg.*,
  ROW_NUMBER() OVER (
    ORDER BY total_certified DESC NULLS LAST, total_applications DESC NULLS LAST
  ) AS rank_volume,
  ROW_NUMBER() OVER (
    ORDER BY certification_rate DESC NULLS LAST, total_certified DESC NULLS LAST
  ) AS rank_cert_rate,
  ROW_NUMBER() OVER (
    PARTITION BY industry
    ORDER BY total_certified DESC NULLS LAST, total_applications DESC NULLS LAST
  ) AS rank_in_industry,
  NOW() AS refreshed_at
FROM agg;

-- UNIQUE index is REQUIRED for REFRESH ... CONCURRENTLY (nightly cron). Per-company grain
-- guarantees uniqueness.
CREATE UNIQUE INDEX h1b_lb_company_id_uidx ON h1b_leaderboard_mv (company_id);

-- Keyset-pagination / sort indexes.
CREATE INDEX h1b_lb_rank_volume_idx ON h1b_leaderboard_mv (rank_volume);
CREATE INDEX h1b_lb_rank_cert_idx   ON h1b_leaderboard_mv (rank_cert_rate);
CREATE INDEX h1b_lb_industry_idx    ON h1b_leaderboard_mv (industry);
CREATE INDEX h1b_lb_size_idx        ON h1b_leaderboard_mv (company_size);

-- Supports the state filter: WHERE top_states @> '[{"state":"CA"}]'::jsonb
CREATE INDEX h1b_lb_top_states_gin  ON h1b_leaderboard_mv USING gin (top_states jsonb_path_ops);
