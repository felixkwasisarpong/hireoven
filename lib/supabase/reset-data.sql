-- =====================================================================
-- Hireoven: reset companies + jobs + H1B/LCA imports + watchlists
--
-- Preserves: profiles, subscriptions, resumes, job_alerts, push_subs,
--            autofill_profiles, marketing_*, waitlist, system_settings.
-- Nulls job_id on: job_applications, resume_edits, autofill_history,
--                  cover_letters (rows survive, just lose the link).
--
-- Run via Supabase SQL editor or:
--   psql $SUPABASE_DB_URL -f lib/supabase/reset-data.sql
-- =====================================================================

BEGIN;

-- 1. Import + aggregate caches (no FKs to user data)
DELETE FROM soc_base_rates;
DELETE FROM employer_lca_stats;
DELETE FROM lca_records;
DELETE FROM h1b_records;

-- 2. Operational company data
DELETE FROM crawl_logs;

-- 3. Per-user watchlist entries (explicit wipe — no trace of any company)
DELETE FROM watchlist;

-- 4. Jobs.
--    CASCADE wipes:   alert_notifications, job_match_scores
--    SET NULL on:     resume_edits.job_id, autofill_history.job_id,
--                     cover_letters.job_id, job_applications.job_id
DELETE FROM jobs;

-- 5. Companies. Any residual watchlist rows CASCADE away here.
DELETE FROM companies;

-- 6. Verification — every row count below should be 0.
SELECT 'companies'          AS tbl, COUNT(*) AS rows FROM companies
UNION ALL SELECT 'jobs',                COUNT(*) FROM jobs
UNION ALL SELECT 'crawl_logs',          COUNT(*) FROM crawl_logs
UNION ALL SELECT 'watchlist',           COUNT(*) FROM watchlist
UNION ALL SELECT 'h1b_records',         COUNT(*) FROM h1b_records
UNION ALL SELECT 'lca_records',         COUNT(*) FROM lca_records
UNION ALL SELECT 'employer_lca_stats',  COUNT(*) FROM employer_lca_stats
UNION ALL SELECT 'soc_base_rates',      COUNT(*) FROM soc_base_rates;

COMMIT;
