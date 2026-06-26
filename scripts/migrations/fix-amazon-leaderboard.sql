-- One-off: fix Amazon showing F(0)/STAFFING on the H-1B leaderboard.
--
-- Root cause: three "Amazon" company rows. The graded one (6f714022, confidence 95,
-- USCIS-derived) is separate from the one the leading-token LCA link attached the
-- 11,751 certified filings to (9005d245, confidence 0). So the leaderboard surfaced
-- the ungraded row -> grade F. Additionally AMAZON.COM SERVICES LLC's employer_lca_stats
-- row is mis-flagged is_staffing_firm=t, and the MV does bool_or(is_staffing_firm),
-- so the whole Amazon row gets tagged STAFFING.
--
-- Fix: merge 9005d245 (jobs + LCA filings) INTO 6f714022 (the graded survivor) using the
-- same mechanics as mergeOne (finish-marked-duplicate-merges.ts), clear the bogus staffing
-- flag, repoint the stale 9cb5e921 dup, recompute job_count. MV refresh runs after commit.
\set C '6f714022-9083-4edb-baf1-babc4c3dbc87'
\set D '9005d245-6dc0-40f3-92bf-48d24af80ff3'
\set Z '9cb5e921-44f3-4302-903f-d5f6e3f7599a'

BEGIN;

-- Carry ATS config onto the survivor only if it lacks one.
UPDATE companies can SET
    careers_url=COALESCE(NULLIF(can.careers_url,''),dup.careers_url),
    direct_ats_url=dup.direct_ats_url, direct_ats_provider=dup.direct_ats_provider,
    ats_type=COALESCE(NULLIF(can.ats_type,''),dup.ats_type), ats_identifier=dup.ats_identifier,
    raw_ats_config=dup.raw_ats_config, next_harvest_at=NOW(), updated_at=NOW()
   FROM companies dup
  WHERE can.id=:'C' AND dup.id=:'D'
    AND COALESCE(NULLIF(can.ats_identifier,''),'')='' AND COALESCE(NULLIF(can.direct_ats_url,''),'')=''
    AND COALESCE(NULLIF(dup.ats_identifier,''),NULLIF(dup.direct_ats_url,''),'')<>'';

-- Jobs: drop dup rows that would collide on external_id, then repoint the rest.
DELETE FROM jobs WHERE company_id=:'D' AND external_id IS NOT NULL
   AND external_id IN (SELECT external_id FROM jobs WHERE company_id=:'C' AND external_id IS NOT NULL);
UPDATE jobs SET company_id=:'C', updated_at=NOW() WHERE company_id=:'D';

-- Watchlist + timing signals: de-collide then repoint.
DELETE FROM watchlist WHERE company_id=:'D' AND user_id IN (SELECT user_id FROM watchlist WHERE company_id=:'C');
UPDATE watchlist SET company_id=:'C' WHERE company_id=:'D';
DELETE FROM application_timing_signals WHERE company_id=:'D' AND (day_of_week,hour_of_day) IN
   (SELECT day_of_week,hour_of_day FROM application_timing_signals WHERE company_id=:'C');
UPDATE application_timing_signals SET company_id=:'C' WHERE company_id=:'D';

-- LCA + sponsorship FK tables (employer_name_normalized stays globally unique -> safe).
UPDATE h1b_records              SET company_id=:'C' WHERE company_id=:'D';
UPDATE lca_records              SET company_id=:'C' WHERE company_id=:'D';
UPDATE hired_outcomes           SET company_id=:'C' WHERE company_id=:'D';
UPDATE post_hire_checkins       SET company_id=:'C' WHERE company_id=:'D';
UPDATE rejection_submissions    SET company_id=:'C' WHERE company_id=:'D';
UPDATE fair_chance_employers    SET company_id=:'C' WHERE company_id=:'D';
UPDATE layoff_events            SET company_id=:'C' WHERE company_id=:'D';
UPDATE employer_lca_stats       SET company_id=:'C' WHERE company_id=:'D';
UPDATE employer_cohort_requests SET company_id=:'C' WHERE company_id=:'D';

-- Deactivate the merged dup and the stale 9cb5e921 -> point both at the survivor.
UPDATE companies SET is_active=false, duplicate_of_company_id=:'C', next_harvest_at=NULL, updated_at=NOW() WHERE id=:'D';
UPDATE companies SET duplicate_of_company_id=:'C', updated_at=NOW() WHERE id=:'Z';

-- Clear the bogus staffing flag: Amazon's own entities are direct employers, not staffing.
UPDATE employer_lca_stats SET is_staffing_firm=false
 WHERE company_id=:'C' AND is_staffing_firm=true AND display_name ILIKE 'AMAZON%';

-- Recompute the survivor's job_count.
UPDATE companies c SET job_count=(SELECT count(*) FROM jobs j WHERE j.company_id=c.id), updated_at=NOW()
 WHERE c.id=:'C';

COMMIT;
