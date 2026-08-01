# Harvester Deployment Plan

End-to-end deployment of the harvester subsystem (`lib/harvester/*`,
`scripts/harvester-worker.ts`, `scripts/discover-*`, `scripts/maintain-*`,
`scripts/enrich-*`, `scripts/bench.ts`).

Designed to be applied in order. Each phase is independently reversible. The
**Verify** sections are checkpoints — don't proceed if they fail.

---

## Prereqs

- Coolify access to the existing `hireoven` project
- `psql` reachable at `$DATABASE_URL`
- The existing Next.js web service is healthy

---

## Phase 0 — Pre-flight (no production change)

```bash
# Pull latest main and confirm tests pass locally
git pull origin main
npm test
# expect: 249 passing, 14 skipped (live-network tests), 0 failing
npx tsc --noEmit
# expect: zero output
```

**Verify:** local tests green, no TS errors.

---

## Phase 1 — Database migrations

All five are additive. Existing readers/writers are unaffected. Order matters
only because the dedup phases reference columns added by earlier migrations.

```bash
psql "$DATABASE_URL" -f scripts/migrations/add-harvester-freshness-tiers.sql
psql "$DATABASE_URL" -f scripts/migrations/add-jobs-unique-external-id.sql
psql "$DATABASE_URL" -f scripts/migrations/add-jobs-duplicate-of-id.sql
psql "$DATABASE_URL" -f scripts/migrations/add-jobs-title-trgm-index.sql
psql "$DATABASE_URL" -f scripts/migrations/add-companies-duplicate-of.sql
```

**Notes:**

- Migration #2 (`add-jobs-unique-external-id.sql`) runs a `DELETE` of
  duplicate `(company_id, external_id)` rows. On a few-thousand-job table
  this is sub-second; on 100k+ rows it can take a few seconds.
- Migration #4 (`add-jobs-title-trgm-index.sql`) needs `pg_trgm`. On Supabase
  enable via Database → Extensions UI first; on self-hosted Postgres, the
  `CREATE EXTENSION IF NOT EXISTS` is no-op if already present.
- Migration #5 enables the worker's `duplicate_of_company_id IS NULL` filter
  — must run BEFORE deploying the new worker binary, else the SELECT throws.

**Verify:**

```bash
psql "$DATABASE_URL" -c "
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'companies'
    AND column_name IN ('freshness_tier','next_harvest_at','duplicate_of_company_id','etag','status')
  ORDER BY column_name"
# expect 5 rows
```

---

## Phase 2 — Smoke-test the new harvest path via the worker cron route

Use the private `app-worker` on the harvester box for smoke tests. Do not point
`scripts/crons.sh` at the public web origin.

In the harvester/app-worker environment:

```
HARVESTER_USE_NEW_ADAPTERS=true
```

Trigger one cron run:

```bash
APP_URL=http://localhost:3100 CRON_SECRET=… bash scripts/crons.sh crawl
```

**Verify after 1 run:**

```sql
-- New columns populated on Greenhouse-routed rows:
SELECT COUNT(*) FILTER (WHERE etag IS NOT NULL) AS with_etag,
       COUNT(*) FILTER (WHERE next_harvest_at IS NOT NULL) AS with_next_harvest,
       COUNT(*) AS total
  FROM companies WHERE ats_type = 'greenhouse';

-- New job columns populating:
SELECT COUNT(*) FILTER (WHERE posted_at IS NOT NULL) AS with_posted_at,
       COUNT(*) FILTER (WHERE source_ats IS NOT NULL) AS with_source_ats,
       COUNT(*) AS total
  FROM jobs WHERE company_id IN (SELECT id FROM companies WHERE ats_type = 'greenhouse')
    AND first_detected_at > now() - interval '2 hours';

-- crawl_logs shows the new path:
SELECT status, COUNT(*) FROM crawl_logs
 WHERE crawled_at > now() - interval '2 hours' GROUP BY status;
```

If anything looks wrong, drop the flag in the worker-side environment and the
next cron returns to legacy behavior. No code changes needed.

---

## Phase 3 — Deploy the harvester worker service

Once Phase 2 is stable for at least one cron cycle, deploy the long-running
worker.

**In Coolify:**

1. Add a new service in the `hireoven` project
2. **Build pack:** Dockerfile
3. **Dockerfile path:** `Dockerfile.harvester`
4. **Same git repo + branch** as the web service
5. **No exposed port** (worker is internal)
6. **Env vars** (copy from web service + add):
   - `DATABASE_URL` — same as web service
   - `HARVESTER_TICK_INTERVAL_MS=30000`
   - `HARVESTER_CLAIM_BATCH_SIZE=20`
   - `HARVESTER_LEASE_SECONDS=900`
   - `HARVESTER_TICK_TIMEOUT_MS=600000`
   - `HARVESTER_PER_COMPANY_TIMEOUT_ORACLECLOUD_MS=420000`
   - `HARVESTER_CONCURRENCY=8`
   - `HARVESTER_FAILURE_COOLDOWN_SECONDS=1800` (failed rows wait at least 30m before retry)
   - `HARVESTER_HTTP2=false` (only set `true` if on Node 22+)
7. **Start command:** uses the Dockerfile's `CMD` — leave default
8. Set **auto-restart on exit**

**Verify worker logs:**

```text
[harvester] started {"tickMs":30000,"batch":20,"leaseSec":900,"defaultConcurrency":8,
  "perAdapter":{"greenhouse":16,"lever":8,"ashby":8,"smartrecruiters":6,"workable":8,
  "workday":4,"recruitee":8,"teamtailor":8,"personio":6,"bamboohr":6,"jazzhr":6,"icims":3,"infosys":1,"apple":1}}
[harvester] tick {"claimed":20,"succeeded":18,"failed":2,"notModified":4,"newJobs":6,"durationMs":3120,
  "failedByAdapter":{"workday":1,"apple":1},"failedByReason":{"timeout":1,"http_403":1}}
```

If the worker logs `claimed=0` repeatedly, check the claim filter — usually
no companies have `status='active' AND duplicate_of_company_id IS NULL`
matching one of the supported `ats_type`s yet. Phase 4 fixes this by
running discovery.

**Verify via `/api/admin/freshness`:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/admin/freshness | jq .tiers
# expect non-zero counts per tier, backlog dropping over successive polls
```

---

## Phase 3.5 — Production findings & tuning notes

**Real numbers from the first dry-run against the production DB** (3,549 companies, 433k jobs, after migrations):

```
tiers:         changed 1536 (tier_1=1224, tier_3=125, tier_dead=187)  → 859ms
status:        markedDead=0                                            → 169ms
resurrect:     resurrected=0                                           → 191ms
company-dedup: markedDuplicate=2                                       → 140ms
dedup (exact): markedDuplicate=158248                                  → 23.7s
fuzzy-dedup:   exceeded 10 min on the unanalyzed dataset; needs tuning
```

Two important operational findings:

1. **Exact dedup will collapse ~158k duplicate active jobs in a single
   first-run.** That's 36% of the active table. Run this BEFORE enabling the
   harvester worker — the cleanup makes every downstream query (matching,
   alerts, dashboards) faster and more accurate. The exact-dedup is fast
   (~24s) and safe.

2. **Fuzzy dedup is too heavy for nightly until the catalog is denormalised.**
   At 115k+ active rows the self-join with `a.title % b.title` runs ~3.8M
   trigram comparisons and times out. After exact-dedup runs once in
   execute mode, the active count drops dramatically (likely to ~50-80k);
   fuzzy-dedup then becomes tractable. **Recommendation:** schedule fuzzy
   dedup weekly (not nightly) and only after exact-dedup has reduced the
   working set. Also `ANALYZE jobs;` after any large data change so the
   planner picks the right join strategy.

**Suggested first-run sequence:**

```bash
# 1. Run a one-shot ANALYZE first so the planner has good stats
psql "$DATABASE_URL" -c "ANALYZE companies; ANALYZE jobs;"

# 2. Run the cheap phases together (skip fuzzy-dedup for now)
npm run maintain:companies:execute -- --only=tiers
npm run maintain:companies:execute -- --only=status
npm run maintain:companies:execute -- --only=company-dedup
npm run maintain:companies:execute -- --only=dedup          # ~24s, collapses 158k
psql "$DATABASE_URL" -c "ANALYZE jobs;"                      # re-stats after the big collapse

# 3. NOW fuzzy-dedup is tractable
npm run maintain:companies:execute -- --only=fuzzy-dedup

# 4. After that, the nightly default order is fine
```

**Recommended cron schedule** (revised for production reality):

| Cron | Schedule | Notes |
|---|---|---|
| `maintain:companies:execute -- --only=tiers,status,resurrect,company-dedup,dedup` | nightly 4am | cheap phases |
| `maintain:companies:execute -- --only=fuzzy-dedup` | weekly Sun 5am | heavy, weekly only |
| `ANALYZE jobs; ANALYZE companies;` (in-cron via psql) | weekly Sun 4:30am | refresh stats before fuzzy-dedup |

## Phase 4 — Schedule the recurring crons

Run recurring jobs on the harvester box, either through
[`../scripts/hetzner-crontab-worker.example`](../scripts/hetzner-crontab-worker.example)
or a scheduler that targets the private `app-worker`
(`APP_URL=http://localhost:3100`). Do not schedule these against the public web
app.

| Cron | Schedule | Purpose |
|---|---|---|
| `npm run discover:github-seeds:execute` | `0 2 * * 0` (Sun 2am) | Weekly GitHub-seed-list discovery |
| `npm run discover:crtsh:execute` | `0 3 * * 0` (Sun 3am) | Weekly crt.sh discovery |
| `npm run discover:startup-directories:execute -- --sources=yc,builtin --builtin-cities=san-francisco,new-york-city,austin,seattle,chicago --limit=250` | `30 3 * * 0` (Sun 3:30am) | Weekly YC + Built In directory discovery |
| `npm run maintain:companies:execute` | `0 4 * * *` (daily 4am) | Tiers + status + resurrect + dedup + fuzzy-dedup |
| `npm run enrich:skills:execute -- --limit=10000` | `30 4 * * *` (daily 4:30am) | Skill enrichment over recent jobs |

**Dry-run each before scheduling:**

```bash
npm run discover:github-seeds                 # expect ~455 candidates
npm run discover:crtsh                        # expect ~250+ candidates (crt.sh-dependent)
npm run discover:startup-directories -- --sources=yc,builtin --limit=40
npm run maintain:companies                    # expect changed counts > 0 per phase
npm run enrich:skills                         # expect scanned/changed counts > 0
```

Wellfound note: its public directory currently serves a DataDome challenge to
clean headless sessions. Use
`npm run discover:startup-directories:execute -- --sources=wellfound --storage-state=/path/to/state.json`
only on runners where you can safely mount a real Playwright storage-state
file.

**Verify after 24h:**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3100/api/admin/freshness | jq .
# detection.samples should be > 100
# detection.p50Sec should be < 900 for tier_1
# recentRuns.runs > 0, jobsInserted > 0
```

---

## Phase 5 — Decide on the legacy cron path

After 48h of the new worker running, the legacy `/api/crawl` cron is doing
duplicate work for Greenhouse-routed companies. Two options:

**Option A — keep both (safest, recommended for the first month):**
- Worker + new harvester path handle the 11 adapter types
- Legacy cron handles HTML/Playwright fallbacks for non-adapter ATSes
- No conflict because `(company_id, external_id)` UPSERT is idempotent

**Option B — deprecate legacy crawl:**
- Disable the `crawl` entry in the harvester-box crontab
- Keep `/api/crawl` route alive for one-off manual triggers
- Legacy code stays in repo — useful as Playwright/HTML fallback path

Recommend Option A until you've seen at least 30 days of clean harvester
operation against your specific catalog.

---

## Phase 6 — Promote your flagship companies to `tier_1`

The maintenance cron auto-assigns tiers based on observed churn, but on day
one nothing has churn data yet. Manually promote the companies you want hot:

```sql
UPDATE companies
   SET freshness_tier = 'tier_1',
       next_harvest_at = now()
 WHERE name IN ('Stripe', 'Anthropic', 'Vercel', 'Discord', 'Plaid', 'Notion')
   AND status = 'active';
```

After the next worker tick, these will harvest every 3 minutes (tier_1
cadence). The maintenance cron will then maintain their tier from observed
signals.

---

## Verification dashboard

Three numbers to watch in the first week:

1. **`recentRuns.jobsInserted`** at `/api/admin/freshness`
   - Should be growing — pre-deploy baseline of new-jobs-per-day × 1.5×
     once discovery channels run their first weekly cycle
2. **`detection.p50Sec`**
   - Target ≤ 300s for tier_1 boards
   - If > 600s, worker is starved — bump `HARVESTER_CONCURRENCY`
3. **Per-tier `backlog`**
   - Should stay near zero for tier_1, low for tier_2
   - Persistent backlog = claim batch too small OR worker crashed

Run `npm run bench` weekly to measure synthetic throughput against the
production company set.

---

## Rollback procedure

**Rollback the worker:**
- Stop the Coolify harvester service
- Disable or pause the harvester-box crontab before stopping `app-worker`
- No data loss; all writes are idempotent

**Rollback the new harvest path on cron route:**
- Remove `HARVESTER_USE_NEW_ADAPTERS=true` from the worker-side env
- Next cron run goes back to legacy crawler for everything

**Rollback a migration:**
- Migrations are additive (only `ADD COLUMN`, `CREATE INDEX`, `CREATE EXTENSION`)
- No `DROP` needed to revert behavior — old code ignores new columns
- If you want the columns gone: `ALTER TABLE ... DROP COLUMN ...`
  - Order matters in reverse: drop `duplicate_of_company_id` before
    `add-companies-duplicate-of.sql` was applied, etc.

**Emergency stop everything:**
- Disable the harvester-box crontab
- Stop the harvester-side services
- The web service keeps serving from existing DB data

---

## Tuning knobs (only if measurements show a problem)

| Symptom | Knob | Default → Try |
|---|---|---|
| Tier-1 freshness P50 > 300s | `HARVESTER_CONCURRENCY` | 8 → 16 |
| Tier-1 freshness P50 > 600s | `HARVESTER_CLAIM_BATCH_SIZE` | 50 → 100 |
| Worker thrashing (high CPU, low throughput) | `HARVESTER_TICK_INTERVAL_MS` | 30000 → 15000 |
| Workday boards taking 60s+ | `CRAWLER_WORKDAY_DESC_MAX_JOBS` | 100 → 50 |
| crt.sh discovery timing out | `DISCOVER_WORKDAY_RESOLVE_CONCURRENCY` | 8 → 4 |
| Skill enrichment too slow | `--limit=N` on the cron | 10000 → 2000 |
| Connection pool exhaustion warnings | `HARVESTER_CONCURRENCY` | reduce |

After tuning, re-run `npm run bench` to verify the change moved the right
metric.

---

## Operational notes

**Legal / ToS / rate-limit posture (per adapter):**

| Adapter | Endpoint | Public/auth | Rate limit policy |
|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{slug}/jobs` | Public, unauthenticated | No documented limit; ETag-cached, ~5 req/sec/host conservative |
| Lever | `api.lever.co/v0/postings/{slug}?mode=json` | Public, unauthenticated | No documented limit; concurrency=8 |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{slug}` | Public, unauthenticated | No documented limit; concurrency=8 |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{slug}/postings` | Public, unauthenticated | Documented as 10 rps/IP; we use 6 |
| Workable | `apply.workable.com/api/v3/accounts/{slug}/jobs` | Public, unauthenticated | No documented limit; concurrency=8 |
| Workday | `{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | Public, unauthenticated POST | Per-tenant; concurrency=4 globally |
| Recruitee | `{slug}.recruitee.com/api/offers/` | Public, unauthenticated | Public widget API; concurrency=8 |
| Teamtailor | `{slug}.teamtailor.com/jobs.json` | Public, unauthenticated | Public board feed; concurrency=8 |
| Personio | `{slug}.jobs.personio.com/xml` | Public, unauthenticated | Public XML feed; concurrency=6 |
| BambooHR | `{slug}.bamboohr.com/careers` (HTML + JSON-LD) | Public HTML | Standard robots.txt posture; concurrency=6 |
| JazzHR | `{slug}.applytojob.com/` (HTML + JSON-LD) | Public HTML | Standard robots.txt posture; concurrency=6 |

**User-Agent:** All harvester requests carry
`hireoven-harvester/1.0 (+https://hireoven.com; bot@hireoven.com)` —
identifies the bot and provides a contact path for ATS vendors who want to
flag traffic.

**robots.txt:** Per-ATS APIs are public job-board endpoints documented for
syndication; we don't crawl logged-in or applicant-only paths. The HTML+JSON-LD
adapters (BambooHR, JazzHR) only fetch the bare `/careers` page, which is
intended to be publicly indexable.

**crt.sh:** Cert transparency logs are a public service. Our queries are
serialised across apexes with 2s pauses between queries to avoid imposing
load on a single-host service known to be flaky.

**GitHub seeds:** SimplifyJobs and similar repos are MIT-licensed; we extract
URLs only, not editorial text. We tag `discovered_via='github-seed:<repo>'`
in the companies table for attribution.

---

## What changed in the codebase (one-line per file)

- `Dockerfile.harvester` — minimal image for the worker service
- `lib/harvester/adapters/*.ts` — 11 ATS adapters + shared base + JSON-LD helper
- `lib/harvester/discovery/*.ts` — crt.sh + GitHub seeds + Workday resolver
- `lib/harvester/canonical-url.ts` — adapter slug → canonical URL
- `lib/harvester/http-agent.ts` — keep-alive + opt-in HTTP/2 dispatcher
- `lib/harvester/maintenance.ts` — 6 SQL maintenance phases
- `lib/harvester/persist-bulk.ts` — single-roundtrip ON CONFLICT upsert
- `lib/harvester/run-harvest.ts` — adapter-agnostic per-company orchestration
- `lib/harvester/worker.ts` — long-running tick loop with per-adapter concurrency
- `lib/jobs/filters.ts`, `lib/jobs/skills-extractor.ts`, `lib/jobs/skills-dictionary.ts` — shared text utilities
- `scripts/harvester-worker.ts` — worker entry point
- `scripts/discover-crtsh.ts`, `scripts/discover-github-seeds.ts` — discovery cron entries
- `scripts/maintain-companies.ts`, `scripts/enrich-job-skills.ts` — enrichment crons
- `scripts/bench.ts` — synthetic-batch + write-throughput bench CLI
- `app/api/admin/freshness/route.ts` — production-state observability endpoint
- `scripts/migrations/add-harvester-*.sql` + `add-jobs-*.sql` + `add-companies-*.sql` — 5 additive migrations
