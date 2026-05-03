-- Employer Financial Health Score — persistent score + funding data
-- Run against your Hireoven Postgres (Coolify / self-hosted).

-- ── Computed health scores (cached, recomputed every 48h) ─────────────────────

CREATE TABLE IF NOT EXISTS public.company_health_scores (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  total_score               INTEGER     NOT NULL DEFAULT 0 CHECK (total_score >= 0 AND total_score <= 100),
  verdict                   TEXT        NOT NULL DEFAULT 'caution'
    CHECK (verdict IN ('strong','healthy','caution','critical')),

  -- Sub-scores (0–25 each)
  funding_score             INTEGER     NOT NULL DEFAULT 0,
  layoff_score              INTEGER     NOT NULL DEFAULT 0,
  glassdoor_score           INTEGER     NOT NULL DEFAULT 12,
  headcount_score           INTEGER     NOT NULL DEFAULT 12,

  -- Funding detail
  funding_stage             TEXT,
  funding_amount_usd        BIGINT,
  funding_date              DATE,
  months_since_funding      INTEGER,

  -- Glassdoor detail
  glassdoor_rating          DECIMAL(4,2),
  glassdoor_rating_12mo_ago DECIMAL(4,2),
  glassdoor_trend           TEXT        NOT NULL DEFAULT 'stable'
    CHECK (glassdoor_trend IN ('improving','stable','declining')),

  -- Headcount detail
  headcount_current         INTEGER,
  headcount_change_12mo_pct DECIMAL(8,2),
  headcount_trend           TEXT        NOT NULL DEFAULT 'stable'
    CHECK (headcount_trend IN ('growing','stable','shrinking','contracting')),

  csuit_departures_12mo     INTEGER     NOT NULL DEFAULT 0,

  -- Rich signal + event arrays for UI
  signals                   JSONB       NOT NULL DEFAULT '[]',
  events                    JSONB       NOT NULL DEFAULT '[]',

  last_computed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS company_health_scores_verdict_idx
  ON public.company_health_scores (verdict, total_score DESC);
CREATE INDEX IF NOT EXISTS company_health_scores_stale_idx
  ON public.company_health_scores (last_computed_at);

COMMENT ON TABLE public.company_health_scores IS
  'Employer financial health scores — derived from funding, layoffs, Glassdoor, and headcount signals.';

-- ── Funding data ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.company_funding_data (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  round_type     TEXT        NOT NULL,   -- seed | series_a | series_b | … | ipo
  amount_usd     BIGINT,
  announced_date DATE        NOT NULL,
  lead_investor  TEXT,
  source_url     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (company_id, round_type, announced_date)
);

CREATE INDEX IF NOT EXISTS company_funding_company_idx
  ON public.company_funding_data (company_id, announced_date DESC);

COMMENT ON TABLE public.company_funding_data IS
  'Funding rounds per company — imported from Crunchbase or public sources.';
