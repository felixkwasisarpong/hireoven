-- One employer, one company record per ATS board.
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
-- Requires scripts/merge-duplicate-ats-companies.ts to have run first: a retired
-- duplicate surrenders its ATS pair, which is what frees the key for this index.
--
-- CONCURRENTLY so the harvester keeps writing during the build; it cannot run
-- inside a transaction block.
--
-- Safe to re-run.

DROP INDEX IF EXISTS uq_companies_ats_pair_active;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_companies_ats_pair
  ON public.companies (ats_type, ats_identifier);
