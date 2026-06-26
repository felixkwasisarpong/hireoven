-- Repair: dedup discarded graded sponsorship_confidence.
--
-- When the company deduper merged a dup into a canonical, it repointed jobs/LCA but
-- did NOT carry the dup's sponsorship_confidence onto the survivor. So whenever the
-- *graded* row (the one the scorecard scored) lost the merge, the surviving active
-- company kept confidence 0 (or a lower value) -> graded F on the H-1B leaderboard
-- despite real certified filings (e.g. Micron 0, Cox 0, Archer 0).
--
-- Fix: for each active company, raise sponsorship_confidence to the best value found
-- across its dup cluster (itself + every row whose duplicate_of_company_id points to it).
-- Dups are same-normalized-name (same company), and we only ever RAISE to the best
-- graded value, so this is safe and idempotent. Re-run anytime after a dedup pass.
--
-- MV refresh runs separately after this (REFRESH ... CONCURRENTLY can't be in a txn).
UPDATE companies c
   SET sponsorship_confidence = sub.dupmax, updated_at = NOW()
  FROM (
    SELECT canon.id, MAX(d.sponsorship_confidence) AS dupmax
      FROM companies canon
      JOIN companies d ON d.duplicate_of_company_id = canon.id
     WHERE canon.is_active = true
     GROUP BY canon.id
  ) sub
 WHERE c.id = sub.id
   AND sub.dupmax > COALESCE(c.sponsorship_confidence, 0);
