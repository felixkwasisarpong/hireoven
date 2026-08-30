# Rollout — discovery pipeline

## READ FIRST: live-feed state (prod backfill already ran)

The `add-ats-tenants` migration was applied to **prod** during development, and
its backfill flipped **~190k recent jobs** `published → visible_enriched` (and
~2k `pending_enrichment → visible_basic`).

Current code treats `published`, `visible_basic`, and `visible_enriched` as
feed-visible. No `FEED_USE_NEW_STATUS` env flag is required.

If deploying an older build that still filters on `publication_status =
'published'`, temporarily revert the data before deploy:
`UPDATE jobs SET publication_status='published'
 WHERE publication_status IN ('visible_basic','visible_enriched') AND is_active=true;`

Verify current exposure:
```sql
SELECT publication_status, COUNT(*) FROM jobs WHERE is_active = true GROUP BY 1;
```

---

## PHASE 0 — Pre-deploy (manual)
a. Duplicate-check (the migration's invariant). If this returns rows, set
   `duplicate_of_company_id` by hand BEFORE the partial unique index is created:
   ```sql
   SELECT ats_type, ats_identifier, COUNT(*) FROM companies
   WHERE ats_type IS NOT NULL AND ats_identifier IS NOT NULL
     AND duplicate_of_company_id IS NULL
   GROUP BY 1,2 HAVING COUNT(*) > 1;
   ```
   (Verified 0 rows on prod during development.)
b. Confirm staging schema matches: `companies`, `jobs`, `discovered_candidates`
   present; `ats_tenants` absent (pre-migration).

## PHASE 1 — Migration (no code change yet)
a. Apply `scripts/migrations/add-ats-tenants.sql` in staging.
   - On a large `jobs` table, prefer the prod-safe variants:
     `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT … NOT VALID` + `VALIDATE`,
     and a batched `FOR UPDATE SKIP LOCKED` backfill for the `visible_enriched`
     update (a single 190k-row UPDATE can deadlock with the live harvester).
b. Verify:
   ```sql
   SELECT to_regclass('public.ats_tenants'),
          to_regclass('public.uq_companies_ats_pair_active'),
          to_regclass('public.ix_jobs_pub_status_active');
   SELECT status, COUNT(*) FROM ats_tenants GROUP BY 1;
   ```
c. Spot-check the backfill: `ats_tenants` enrolled count ≈ distinct
   `(ats_type, ats_identifier)` among non-duplicate companies:
   ```sql
   SELECT
     (SELECT COUNT(*) FROM ats_tenants WHERE status='enrolled') AS tenants,
     (SELECT COUNT(DISTINCT (ats_type, ats_identifier)) FROM companies
        WHERE ats_type IS NOT NULL AND ats_identifier IS NOT NULL
          AND duplicate_of_company_id IS NULL) AS distinct_pairs;
   ```

## PHASE 2 — Code deploy
a. Deploy the current code. `visible_*` jobs are feed-visible by default.
b. Verify adzuna / dice / discover-tenants crons run without errors
   (watch logs for `aggregator_backsolve` lines and no unhandled throws).
c. `GET /api/admin/discovery-stats` (admin auth) returns a payload.

## PHASE 3 — Backsolver canary
a. Manually trigger ingest on a small sample (e.g. one Adzuna query) or run
   `npx tsx scripts/backsolve-active-unmatched.ts --limit=100` (dry run).
b. Check `/api/admin/discovery-stats` → `last24h.backsolve_success_rate`.
c. If `success_rate > 0.20` and no error spikes → proceed. (Note: the
   active-unmatched legacy backlog measured ~1% in dev; fresh apply URLs from
   live ingest should score higher.)

## PHASE 4 — Full ingest cutover
a. Adzuna & Dice already route via the backsolver **unconditionally** (the
   prompt-6/9 rewire has no flag). Nothing to toggle.
b. Watch `tenant.enrolled` (and `tenant.retry_later`) over 24h via the stats
   endpoint and `ats_tenants`:
   ```sql
   SELECT status, COUNT(*) FROM ats_tenants GROUP BY 1;
   ```

## PHASE 5 — Feed verification
a. Monitor `last24h.jobs_publication_status_breakdown` for 24h.
b. Quality complaints require a redeploy or a code-level rollback to a narrower
   feed predicate; there is no env-flag feed flip in current code.

---

## Rollback per phase
- **Phase 1 (migration):** no separate down-migration file exists (repo is
  up-only). Manual rollback:
  ```sql
  DROP INDEX IF EXISTS ix_jobs_pub_status_active;
  DROP INDEX IF EXISTS uq_companies_ats_pair_active;
  DROP TABLE IF EXISTS ats_tenants;            -- derived data; safe to lose
  ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_publication_status_check;
  ALTER TABLE jobs ADD CONSTRAINT jobs_publication_status_check
    CHECK (publication_status IN ('published','pending_enrichment','hidden_low_quality'));
  -- (optional) revert backfilled statuses:
  UPDATE jobs SET publication_status='published'
   WHERE publication_status IN ('visible_basic','visible_enriched');
  UPDATE jobs SET publication_status='pending_enrichment'
   WHERE publication_status='hidden_expired';   -- only if desired
  ```
  The companies `resolution_*` columns can stay (harmless).
- **Phase 2 (code):** redeploy the previous build.
- **Phase 3+ (backsolver):** the feed predicate is no longer env-gated. The
  **aggregator backsolver itself is NOT gated** — adzuna/dice call it
  unconditionally. To make the backsolver instantly revertible you must add an
  `AGGREGATOR_USE_BACKSOLVER` env gate around the `backsolveAggregatorCompany`
  calls in `adzuna-ingest`/`dice-ingest` (and fall back to the legacy
  placeholder path). **This gate does not exist yet** (a code change, deferred
  per "no new code"). Until added, rolling back the backsolver = redeploy the
  previous build.
