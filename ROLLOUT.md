# Rollout — discovery pipeline

## ⚠️ READ FIRST: live-feed state (prod backfill already ran)

The `add-ats-tenants` migration was applied to **prod** during development, and
its backfill flipped **~190k recent jobs** `published → visible_enriched` (and
~2k `pending_enrichment → visible_basic`).

The **currently deployed** prod code filters the feed on
`publication_status = 'published'` (old `sqlPublishedJob`). So those ~190k
`visible_enriched` jobs are **excluded from the live feed right now.**

Pick ONE before/at deploy:
- **Preferred:** deploy the new code and set `FEED_USE_NEW_STATUS=true` in the
  same window (PHASE 2 + PHASE 5 collapsed), so `visible_*` are visible again.
- **If new code can't go out yet:** temporarily revert the data —
  `UPDATE jobs SET publication_status='published'
   WHERE publication_status IN ('visible_basic','visible_enriched') AND is_active=true;`
  then proceed with the normal phased plan later.

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

## PHASE 2 — Code deploy with flags OFF
a. Deploy with `FEED_USE_NEW_STATUS=false`. (See the ⚠️ above — with the flag
   off, freshly-persisted `visible_*` jobs are NOT in the feed.)
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

## PHASE 5 — Feed flip
a. Set `FEED_USE_NEW_STATUS=true`.
b. Monitor `last24h.jobs_publication_status_breakdown` for 24h.
c. Quality complaints → set `FEED_USE_NEW_STATUS=false` for an instant revert
   (feed returns to `published`-only). No redeploy needed.

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
- **Phase 3+ (backsolver):** `FEED_USE_NEW_STATUS=false` reverts the feed, but
  **the aggregator backsolver itself is NOT gated** — adzuna/dice call it
  unconditionally. To make the backsolver instantly revertible you must add an
  `AGGREGATOR_USE_BACKSOLVER` env gate around the `backsolveAggregatorCompany`
  calls in `adzuna-ingest`/`dice-ingest` (and fall back to the legacy
  placeholder path). **This gate does not exist yet** (a code change, deferred
  per "no new code"). Until added, rolling back the backsolver = redeploy the
  previous build.
