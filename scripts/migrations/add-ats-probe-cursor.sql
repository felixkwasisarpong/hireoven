-- Cursor for the automated tenant-probe cron (app/api/cron/discover-tenants).
-- The cron resolves unmatched companies (ats_type IS NULL) to their real ATS by
-- probing name-derived slugs against the ATS APIs. This column records the last
-- time a company was probed so each cron run advances through the backlog
-- instead of re-probing the same newest rows.
ALTER TABLE "public"."companies"
  ADD COLUMN IF NOT EXISTS "ats_probe_attempted_at" timestamp with time zone;

-- Partial index = the probe queue: unmatched, active, never-probed, ordered by
-- job_count so companies we already know are hiring get resolved first.
CREATE INDEX IF NOT EXISTS "idx_companies_ats_probe_queue"
  ON "public"."companies" ("job_count" DESC NULLS LAST)
  WHERE "ats_type" IS NULL
    AND "ats_probe_attempted_at" IS NULL
    AND "is_active" = true
    AND "duplicate_of_company_id" IS NULL;
