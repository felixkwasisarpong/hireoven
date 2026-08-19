-- One company record per ATS board.
--
-- `uq_companies_ats_pair_active` was unique on (ats_type, ats_identifier) but only
-- WHERE duplicate_of_company_id IS NULL. That predicate could be laundered:
-- flagging a row as a duplicate removed it from the guard without merging
-- anything — its jobs stayed live — which freed the next discovery subsystem to
-- insert yet another copy of the same board. 3,002 ATS pairs ended up held by
-- more than one company record, 1,534 of them with no canonical row at all
-- because every member was flagged, and 3,014 rows sat in mutual a->b->a cycles
-- that no resolver could follow to a survivor.
--
-- The replacement has no predicate to launder. NULLs stay distinct in Postgres by
-- default, so companies with no ATS pair are unaffected and can still be many.
--
-- ORDER OF OPERATIONS — this migration is NOT safe to apply on its own:
--
--   1. Run scripts/merge-duplicate-ats-companies.ts to completion. A retired
--      duplicate surrenders its ATS pair, which is what frees the key.
--   2. Adjudicate the groups it holds as ambiguous. Those are boards whose
--      records carry two different real domains — `ashby/column` is claimed by
--      both Column and Column Five Media, two unrelated employers that landed on
--      the same guessed identifier. They are NOT duplicates, and until one of
--      them has its identifier corrected the pair is genuinely not unique, so
--      this index cannot be created.
--   3. Then apply this file.
--
-- The guard below is why step 2 cannot be skipped: it aborts rather than letting
-- CREATE INDEX fail halfway through a maintenance window. Run with psql
-- ON_ERROR_STOP=1 so the abort stops the script.
--
-- Safe to re-run.

DO $$
DECLARE
  offending int;
BEGIN
  SELECT count(*) INTO offending FROM (
    SELECT ats_type, ats_identifier
      FROM companies
     WHERE ats_type IS NOT NULL AND ats_identifier IS NOT NULL
     GROUP BY 1, 2
    HAVING count(*) > 1
  ) t;

  IF offending > 0 THEN
    RAISE EXCEPTION
      'Cannot create uq_companies_ats_pair: % ATS pair(s) are still held by more than one company. Run scripts/merge-duplicate-ats-companies.ts, then adjudicate the groups it reports as ambiguous.',
      offending;
  END IF;
END $$;

DROP INDEX IF EXISTS uq_companies_ats_pair_active;

-- CONCURRENTLY so the harvester keeps writing during the build; it cannot run
-- inside a transaction block.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_companies_ats_pair
  ON public.companies (ats_type, ats_identifier);
