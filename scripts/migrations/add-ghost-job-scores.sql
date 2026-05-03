-- Ghost Job Detector — persistent score table + company news signals
-- Run against your Hireoven Postgres (Coolify / self-hosted).

CREATE TABLE IF NOT EXISTS public.ghost_job_scores (
  id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                     UUID        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,

  -- Computed risk
  risk_score                 INTEGER     CHECK (risk_score >= 0 AND risk_score <= 100),
  risk_level                 TEXT        NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'unknown')),

  -- Detailed signal snapshot (array of { name, value, weight, status, detail })
  signals                    JSONB       NOT NULL DEFAULT '[]',

  -- Raw signal values kept as first-class columns for query efficiency
  repost_count               INTEGER,
  url_status                 TEXT        CHECK (url_status IN ('live', 'redirects', 'dead', 'unknown')),
  has_hiring_freeze          BOOLEAN     NOT NULL DEFAULT FALSE,
  has_salary                 BOOLEAN     NOT NULL DEFAULT FALSE,
  description_vagueness_score INTEGER,

  -- Freshness
  last_scanned_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (job_id)
);

CREATE INDEX IF NOT EXISTS ghost_job_scores_last_scanned_idx
  ON public.ghost_job_scores (last_scanned_at);

COMMENT ON TABLE public.ghost_job_scores IS
  'Cached ghost-job risk scores — refreshed every 24 hours per job by the scan worker.';

-- ── Company news signals ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.company_news_signals (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        REFERENCES public.companies(id) ON DELETE CASCADE,
  signal_type  TEXT        NOT NULL,   -- 'hiring_freeze' | 'layoff' | 'office_closure' | 'acquisition'
  headline     TEXT,
  source_url   TEXT,
  detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS company_news_signals_company_id_idx
  ON public.company_news_signals (company_id, signal_type, detected_at DESC);

COMMENT ON TABLE public.company_news_signals IS
  'Crowd-sourced and crawled company news signals (hiring freeze, layoffs, etc.).';
