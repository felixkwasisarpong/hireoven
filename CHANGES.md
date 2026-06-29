# Discovery pipeline overhaul — CHANGES

Backsolve aggregator apply URLs to real ATS tenants, enroll them as harvestable
companies, track everything in a new `ats_tenants` registry, and surface flow
metrics. Persist-side job statuses move to a `visible_basic`/`visible_enriched`
model behind a feed feature flag.

## Files added

| File | Summary |
|---|---|
| `scripts/migrations/add-ats-tenants.sql` | `ats_tenants` table, companies dedup partial unique index, extended `publication_status` CHECK, companies resolution columns, backfills |
| `lib/discovery/resolve-apply-url-to-tenant.ts` | Backsolver: follow an apply URL's redirect chain + HTML → detect ATS → validate board has jobs |
| `lib/discovery/resolve-apply-url-to-tenant.test.ts` | Backsolver tests (undici MockAgent): direct/redirect/embedded/garbage/empty/404/loop/timeout/rate-limited |
| `lib/discovery/ats-rate-limiter.ts` | Per-ATS-host token bucket (`withAtsRateLimit`, `QueueFullError`, metrics getter) |
| `lib/discovery/enroll-tenant-as-company.ts` | Upsert `ats_tenants` + enroll/link a company (`enrollTenantAsCompany`, `buildCareersUrl`) |
| `lib/discovery/enroll-tenant-as-company.test.ts` | Enrollment tests (fake pool): new/existing/domain-conflict, tier mapping, name fallback |
| `lib/discovery/candidate-priority.ts` | `CANDIDATE_PRIORITY_ORDER_SQL` + `candidatePriorityScore` JS mirror for discover-tenants claim ordering |
| `lib/discovery/candidate-priority.test.ts` | Priority-score unit tests (4 spec scenarios) |
| `lib/discovery/confidence-score.test.ts` | `fastPathDecision` branch tests |
| `lib/jobs/aggregator-backsolve.ts` | Shared adzuna/dice backsolve→enroll/retry/placeholder router with structured logs |
| `lib/jobs/aggregator-backsolve.test.ts` | Routing tests: with/without apply URL, enrolled/no-ats/board-error |
| `lib/observability/metrics.ts` | In-process metrics (hourly-bucket counters/gauges, capped histograms, `snapshot24h`) |
| `lib/admin/discovery-stats.ts` | `buildDiscoveryStats(pool)` — durable SQL + metrics snapshot payload |
| `lib/admin/discovery-stats.test.ts` | Payload shape + computed-rate tests |
| `app/api/admin/discovery-stats/route.ts` | Admin GET endpoint (assertAdminAccess → buildDiscoveryStats) |
| `scripts/backsolve-active-unmatched.ts` | One-off backfill for active-but-unmatched companies (dry-run/`--apply`) |

## Files modified

| File | What changed |
|---|---|
| `lib/companies/ats-url-resolver.ts` | Exported `detectAtsInHtml` (was private); doc note |
| `lib/discovery/confidence-score.ts` | Added `fastPathDecision` + `FAST_PATH_ATS` above `computeConfidence` (unchanged); thresholds untouched |
| `app/api/cron/discover-tenants/route.ts` | Priority-scored claim (placeholders only); apply-URL backsolve-first; `markResolution` bookkeeping; fast-path enroll; retry_later metric |
| `app/api/cron/adzuna-ingest/route.ts` | `missing`-company loop routes through the backsolver at `pLimit(4)` + time budget; placeholder fallback tagged via `discovered_via` |
| `app/api/cron/dice-ingest/route.ts` | Replaced `enrollFromApplyUrl` call with the shared backsolver (same concurrency/budget pattern) |
| `lib/harvester/discovery/enroll-from-apply-url.ts` | Now a thin back-compat wrapper over `resolveApplyUrlToAtsTenant` → `enrollTenantAsCompany` (signature unchanged) |
| `lib/jobs/publication.ts` | `publicationStatusForInsert`, `SQL_UPGRADE_TO_VISIBLE_ENRICHED`, and feature-flagged `sqlPublishedJob` |
| `lib/jobs/publication.test.ts` | Tests for `publicationStatusForInsert` + `FEED_USE_NEW_STATUS` behavior |
| `lib/harvester/persist-bulk.ts` | New inserts use `visible_basic`/`visible_enriched`; try/catch around normalize (fallback row); stale sweep sets `hidden_expired`; jobs/normalize metrics |
| `app/api/apex/chat/route.ts` | Inline feed filter switched to `sqlPublishedJob("j")` so the flag covers it |
| `scripts/discover-from-domains-render.ts` | Fixed broken `--apply` claim (multi-column `id IN (...)` → CTE) |
| `scripts/fix-logo-batch-targets.ts` | Logo backfill batches (separate logo-fix task, not part of the discovery feature) |

## Migrations added

- `scripts/migrations/add-ats-tenants.sql` — idempotent. Creates `ats_tenants`
  (+ 4 indexes), `uq_companies_ats_pair_active` partial unique index, the
  extended `jobs_publication_status_check`, companies `resolution_attempts` /
  `last_resolution_attempted_at` / `last_resolution_failed_at`, and two backfills
  (tenants from enrolled companies; recent jobs → `visible_*`).
  ⚠️ Applied to prod during development via a prod-safe path (CONCURRENTLY
  indexes, `NOT VALID` + `VALIDATE` constraint, batched `SKIP LOCKED` backfill).

## Env vars added

| Var | Default | Where | Purpose |
|---|---|---|---|
| `FEED_USE_NEW_STATUS` | `false` | `lib/jobs/publication.ts` | When `true`, feed includes `visible_basic`+`visible_enriched` (not just `published`) |
| `ATS_RATE_LIMIT_<HOST>_RPS` | `5` | `lib/discovery/ats-rate-limiter.ts` | Per-ATS req/sec (e.g. `ATS_RATE_LIMIT_GREENHOUSE_RPS`) |
| `ATS_RATE_LIMIT_<HOST>_BURST` | `10` | `lib/discovery/ats-rate-limiter.ts` | Per-ATS burst |
| `ATS_RATE_LIMIT_QUEUE_CAP` | `200` | `lib/discovery/ats-rate-limiter.ts` | Per-host queue depth before `QueueFullError` |
| `ATS_RESOLVE_TIMEOUT_MS` | `10000` | `lib/discovery/resolve-apply-url-to-tenant.ts` | Backsolver per-phase timeout |
| `AGGREGATOR_BACKSOLVE_CONCURRENCY` | `4` | adzuna/dice ingest | Parallel backsolves per cron tick |
| `AGGREGATOR_BACKSOLVE_BUDGET_MS` | `150000` | adzuna/dice ingest | Stop opening new backsolves past this; fall back to placeholder |

## Metric names added

Counters:
- `apply_url.backsolve.attempt` `{sourceType}`
- `apply_url.backsolve.success` `{sourceType, atsType}`
- `apply_url.backsolve.failure` `{sourceType, reason}`
- `tenant.upsert` `{atsType, sourceType}`
- `tenant.discovered` `{atsType, sourceType}`
- `tenant.enrolled` `{atsType, sourceType, created}`
- `tenant.retry_later` `{atsType, sourceType, reason}`
- `tenant.validated`, `tenant.rejected` — surfaced in the endpoint but **not yet emitted** (no code path transitions a tenant to those states; report 0)
- `jobs.persisted` `{atsType, status}`
- `jobs.publication_status` `{value}`
- `normalize.failure` `{atsType, reason}`
- `ats_rate_limit.queued` `{atsType}`
- `ats_rate_limit.throttled` `{atsType}`

Histogram:
- `apply_url.backsolve.duration_ms` `{sourceType, atsType}`
