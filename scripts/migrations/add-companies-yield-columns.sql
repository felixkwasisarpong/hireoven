-- Yield tracking columns for the crawl-budget optimizer.
-- These are computed by maintenance.ts after each maintenance pass and used
-- by run-harvest.ts to adjust the effective crawl interval per company.

ALTER TABLE "public"."companies"
  -- Average new jobs per crawl over the last 30 days. Updated by maintenance.
  ADD COLUMN IF NOT EXISTS "yield_score" numeric(5,2) DEFAULT 0,
  -- Consecutive crawls that found zero active jobs. Reset to 0 when jobs appear.
  ADD COLUMN IF NOT EXISTS "consecutive_empty_crawls" integer NOT NULL DEFAULT 0,
  -- Last time at least one active job was seen for this company.
  ADD COLUMN IF NOT EXISTS "last_job_seen_at" timestamp with time zone,
  -- Whether at least one USA-located job was confirmed for this source.
  -- NULL = not yet checked, TRUE = confirmed, FALSE = only non-USA jobs seen.
  ADD COLUMN IF NOT EXISTS "usa_confirmed" boolean,
  ADD COLUMN IF NOT EXISTS "usa_confirmed_at" timestamp with time zone;

-- Used by scheduler to quickly find high-yield sources that are due.
CREATE INDEX IF NOT EXISTS "idx_companies_yield"
  ON "public"."companies" ("yield_score" DESC)
  WHERE "status" = 'active' AND "is_active" = true;

-- Used by maintenance to find long-empty boards eligible for yield_paused demotion.
CREATE INDEX IF NOT EXISTS "idx_companies_empty_crawls"
  ON "public"."companies" ("consecutive_empty_crawls")
  WHERE "consecutive_empty_crawls" > 10;

-- Extend crawl_logs to track post-crawl active job count and cost class.
ALTER TABLE "public"."crawl_logs"
  -- Active job count in DB immediately after this crawl completed.
  ADD COLUMN IF NOT EXISTS "jobs_active_after" integer,
  -- Rough cost bucket for budget analysis.
  ADD COLUMN IF NOT EXISTS "cost_class" text
    CHECK ("cost_class" IN ('api_fast', 'api_slow', 'html', 'browser'));
