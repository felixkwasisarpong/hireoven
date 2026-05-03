-- Layoff data ingestion pipeline — feeds Ghost Job Detector + Employer Financial Health
-- Run against your Hireoven Postgres (Coolify / self-hosted).

-- ── Raw layoff events ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.layoff_events (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  company_name_raw     TEXT        NOT NULL,

  source               TEXT        NOT NULL
    CHECK (source IN ('layoffs_fyi','warn_act','news_signal')),

  event_date           DATE        NOT NULL,
  employees_affected   INTEGER,
  percentage_affected  DECIMAL(6,3),
  location             TEXT,
  industry             TEXT,
  source_url           TEXT,
  headline             TEXT,
  is_verified          BOOLEAN     NOT NULL DEFAULT FALSE,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Deduplication constraint
  UNIQUE (company_name_raw, event_date, source)
);

CREATE INDEX IF NOT EXISTS layoff_events_company_id_idx
  ON public.layoff_events (company_id, event_date DESC);
CREATE INDEX IF NOT EXISTS layoff_events_source_idx
  ON public.layoff_events (source, created_at DESC);
CREATE INDEX IF NOT EXISTS layoff_events_unmatched_idx
  ON public.layoff_events (company_id) WHERE company_id IS NULL;

COMMENT ON TABLE public.layoff_events IS
  'Raw layoff events from layoffs.fyi and WARN Act — matched to companies after import.';

-- ── Company layoff summary (recomputed after each import) ─────────────────────

CREATE TABLE IF NOT EXISTS public.company_layoff_summary (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                 UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  total_layoff_events        INTEGER     NOT NULL DEFAULT 0,
  total_employees_affected   INTEGER,
  most_recent_layoff_date    DATE,
  days_since_last_layoff     INTEGER,

  has_active_freeze          BOOLEAN     NOT NULL DEFAULT FALSE,
  freeze_confidence          TEXT
    CHECK (freeze_confidence IN ('confirmed','likely','possible')),

  layoff_trend               TEXT        NOT NULL DEFAULT 'stable'
    CHECK (layoff_trend IN ('accelerating','stable','recovering')),

  last_computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (company_id)
);

CREATE INDEX IF NOT EXISTS company_layoff_summary_active_idx
  ON public.company_layoff_summary (has_active_freeze, freeze_confidence)
  WHERE has_active_freeze = TRUE;

COMMENT ON TABLE public.company_layoff_summary IS
  'Aggregated layoff summary per company — drives Ghost Job Detector freeze signals and Employer Health Score.';

-- ── Match review queue ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.layoff_match_review (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name_raw     TEXT        NOT NULL,
  suggested_company_id UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  confidence           TEXT        NOT NULL CHECK (confidence IN ('exact','high','medium','low','none')),
  source               TEXT        NOT NULL CHECK (source IN ('layoffs_fyi','warn_act','news_signal')),
  reviewed             BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS layoff_match_review_unreviewed_idx
  ON public.layoff_match_review (reviewed, created_at DESC)
  WHERE reviewed = FALSE;

COMMENT ON TABLE public.layoff_match_review IS
  'Low-confidence company matches from layoff imports — queue for manual review.';
