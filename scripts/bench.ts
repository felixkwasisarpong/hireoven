/**
 * Hireoven harvester benchmark.
 *
 *   npx tsx scripts/bench.ts --sample=30
 *   npx tsx scripts/bench.ts --adapter=greenhouse --sample=20
 *   npx tsx scripts/bench.ts --no-production
 *
 * Two halves:
 *   1. Production state from DB: per-tier counts, backlog, freshness percentiles,
 *      detection lag (posted_at → first_detected_at).
 *   2. Synthetic batch: pulls a random sample of companies (rotating across
 *      adapters), times adapter.fetchJobs() in parallel, computes P50/P95 per
 *      adapter and aggregate calls-per-second.
 *
 * Read-only — never persists. Compares results to §4 targets and emits
 * knob-turning hints when a target is missed.
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { detectAdapter, type AtsAdapter, type AtsName } from "@/lib/harvester/adapters"
import { hashContent, type HarvestedJob } from "@/lib/harvester/adapters/_base"
import { persistJobsBulk } from "@/lib/harvester/persist-bulk"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const TARGETS = {
  tier1FreshnessP50Sec: 300, // 5 min
  tier1FreshnessP95Sec: 900, // 15 min
  detectionP50Sec: 300,
  detectionP95Sec: 900,
  atsCallsPerSec: 200,
  jobsPerSec: 5_000,
}

type CliArgs = {
  sample: number
  adapterFilter: AtsName | null
  concurrency: number
  skipProduction: boolean
  seedUrls: string[] | null
  persistBenchSize: number | null
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const get = (prefix: string): string | undefined =>
    args.find((a) => a.startsWith(prefix))?.split("=")[1]
  const urlsArg = get("--urls=")
  const persistArg = get("--persist-bench=")
  return {
    sample: Math.max(1, Number.parseInt(get("--sample=") ?? "30", 10)),
    adapterFilter: (get("--adapter=") ?? null) as AtsName | null,
    concurrency: Math.max(1, Number.parseInt(get("--concurrency=") ?? "8", 10)),
    skipProduction: args.includes("--no-production") || Boolean(urlsArg),
    seedUrls: urlsArg ? urlsArg.split(",").map((u) => u.trim()).filter(Boolean) : null,
    persistBenchSize: persistArg ? Math.max(1, Number.parseInt(persistArg, 10)) : null,
  }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

function pass(label: string, ok: boolean): string {
  return `${ok ? "PASS" : "FAIL"} ${label}`
}

type TierRow = {
  freshness_tier: string
  companies: number
  backlog: number
  p50_lag_sec: number | null
  p95_lag_sec: number | null
}

async function readProductionState() {
  const pool = getPostgresPool()
  const tiersResult = await pool.query<{
    freshness_tier: string
    companies: string
    backlog: string
    p50_lag_sec: number | null
    p95_lag_sec: number | null
  }>(
    `SELECT
       COALESCE(freshness_tier, 'tier_2') AS freshness_tier,
       COUNT(*)                                                          AS companies,
       COUNT(*) FILTER (
         WHERE status = 'active'
           AND next_harvest_at IS NOT NULL
           AND next_harvest_at <= now()
       )                                                                 AS backlog,
       percentile_cont(0.50) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (now() - last_crawled_at))
       ) FILTER (WHERE status = 'active' AND last_crawled_at IS NOT NULL) AS p50_lag_sec,
       percentile_cont(0.95) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (now() - last_crawled_at))
       ) FILTER (WHERE status = 'active' AND last_crawled_at IS NOT NULL) AS p95_lag_sec
     FROM companies
     GROUP BY 1
     ORDER BY 1`
  )
  const tiers: TierRow[] = tiersResult.rows.map((r) => ({
    freshness_tier: r.freshness_tier,
    companies: Number(r.companies),
    backlog: Number(r.backlog),
    p50_lag_sec: r.p50_lag_sec === null ? null : Math.round(r.p50_lag_sec),
    p95_lag_sec: r.p95_lag_sec === null ? null : Math.round(r.p95_lag_sec),
  }))

  const detectionResult = await pool.query<{
    samples: string
    p50_sec: number | null
    p95_sec: number | null
  }>(
    `SELECT
       COUNT(*) AS samples,
       percentile_cont(0.50) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (first_detected_at - posted_at))
       ) AS p50_sec,
       percentile_cont(0.95) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (first_detected_at - posted_at))
       ) AS p95_sec
     FROM jobs
     WHERE posted_at IS NOT NULL
       AND first_detected_at IS NOT NULL
       AND first_detected_at >= now() - interval '24 hours'
       AND first_detected_at >= posted_at`
  )
  const detection = {
    samples: Number(detectionResult.rows[0]?.samples ?? 0),
    p50_sec: detectionResult.rows[0]?.p50_sec === null ? null : Math.round(detectionResult.rows[0]!.p50_sec!),
    p95_sec: detectionResult.rows[0]?.p95_sec === null ? null : Math.round(detectionResult.rows[0]!.p95_sec!),
  }

  return { tiers, detection }
}

type SampleCompany = {
  id: string
  name: string
  careers_url: string
  etag: string | null
  last_modified: string | null
  ats_type: string | null
}

async function pickSample(
  sample: number,
  adapterFilter: AtsName | null
): Promise<SampleCompany[]> {
  const pool = getPostgresPool()
  const filter = adapterFilter ? `AND ats_type = $2` : ""
  const params: unknown[] = [sample]
  if (adapterFilter) params.push(adapterFilter)
  const { rows } = await pool.query<SampleCompany>(
    `SELECT id, name, careers_url, etag, last_modified, ats_type
     FROM companies
     WHERE is_active = true
       AND careers_url IS NOT NULL
       ${filter}
     ORDER BY random()
     LIMIT $1`,
    params
  )
  return rows
}

type FetchOutcome = {
  adapterName: string
  durationMs: number
  jobsCount: number
  notModified: boolean
  ok: boolean
  reason: string | null
}

async function timedFetch(
  company: SampleCompany,
  adapter: AtsAdapter,
  slug: string
): Promise<FetchOutcome> {
  const startedAt = Date.now()
  try {
    const result = await adapter.fetchJobs({
      slug,
      ctx: { etag: company.etag, lastModified: company.last_modified },
    })
    return {
      adapterName: adapter.name,
      durationMs: Date.now() - startedAt,
      jobsCount: result.jobs.length,
      notModified: result.notModified,
      ok: true,
      reason: null,
    }
  } catch (error) {
    return {
      adapterName: adapter.name,
      durationMs: Date.now() - startedAt,
      jobsCount: 0,
      notModified: false,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

function summariseByAdapter(outcomes: FetchOutcome[]) {
  const byAdapter = new Map<string, FetchOutcome[]>()
  for (const o of outcomes) {
    const list = byAdapter.get(o.adapterName) ?? []
    list.push(o)
    byAdapter.set(o.adapterName, list)
  }

  const rows: Array<{
    adapter: string
    count: number
    ok: number
    failed: number
    notModified: number
    p50_ms: number | null
    p95_ms: number | null
    jobs: number
  }> = []

  for (const [adapter, list] of byAdapter) {
    const durations = list
      .filter((o) => o.ok)
      .map((o) => o.durationMs)
      .sort((a, b) => a - b)
    rows.push({
      adapter,
      count: list.length,
      ok: list.filter((o) => o.ok).length,
      failed: list.filter((o) => !o.ok).length,
      notModified: list.filter((o) => o.notModified).length,
      p50_ms: percentile(durations, 50),
      p95_ms: percentile(durations, 95),
      jobs: list.reduce((sum, o) => sum + o.jobsCount, 0),
    })
  }

  rows.sort((a, b) => a.adapter.localeCompare(b.adapter))
  return rows
}

function emitHints(args: {
  perAdapter: ReturnType<typeof summariseByAdapter>
  tiers: TierRow[]
  detection: { samples: number; p50_sec: number | null; p95_sec: number | null }
  effectiveCallsPerSec: number
  wallTimeMs: number
}) {
  const hints: string[] = []
  const { perAdapter, tiers, detection, effectiveCallsPerSec } = args

  if (effectiveCallsPerSec < TARGETS.atsCallsPerSec) {
    const workdayDominant = perAdapter.find((r) => r.adapter === "workday" && r.p50_ms && r.p50_ms > 10_000)
    if (workdayDominant) {
      hints.push(
        `Workday p50=${workdayDominant.p50_ms}ms dominates the batch — shard Workday to a separate worker (HARVESTER_WORKDAY_CONCURRENCY env or a dedicated worker service), or cap MAX_PAGES.`
      )
    } else {
      hints.push(
        `Aggregate ATS calls/sec=${Math.round(effectiveCallsPerSec)} under target ${TARGETS.atsCallsPerSec}. Bump HARVESTER_CONCURRENCY (currently 8 by default), or raise HARVESTER_CLAIM_BATCH_SIZE.`
      )
    }
  }

  const tier1 = tiers.find((t) => t.freshness_tier === "tier_1")
  if (tier1) {
    if ((tier1.p50_lag_sec ?? Infinity) > TARGETS.tier1FreshnessP50Sec) {
      hints.push(
        `Tier 1 freshness p50=${tier1.p50_lag_sec}s exceeds target ${TARGETS.tier1FreshnessP50Sec}s. Worker isn't keeping up: check claim backlog (${tier1.backlog}), then raise HARVESTER_CLAIM_BATCH_SIZE / HARVESTER_CONCURRENCY.`
      )
    }
    if (tier1.backlog > 0 && (tier1.p50_lag_sec ?? 0) > TARGETS.tier1FreshnessP50Sec * 2) {
      hints.push(
        `Tier 1 backlog=${tier1.backlog} + freshness drift suggests the worker is starved. Either tier_1 was over-promoted (audit assignment), or worker has stalled.`
      )
    }
  }

  if (detection.samples > 50) {
    if ((detection.p50_sec ?? Infinity) > TARGETS.detectionP50Sec) {
      hints.push(
        `Detection lag p50=${detection.p50_sec}s exceeds target ${TARGETS.detectionP50Sec}s. ETag isn't catching unchanged boards, or tick interval is too long. Verify ETag persistence and lower HARVESTER_TICK_INTERVAL_MS.`
      )
    }
  } else if (detection.samples === 0) {
    hints.push(
      `Detection lag has no samples — adapters haven't run via the new path yet, or posted_at is missing from rows. Set HARVESTER_USE_NEW_ADAPTERS=true or start the worker.`
    )
  }

  const failed = perAdapter.reduce((sum, r) => sum + r.failed, 0)
  if (failed > 0) {
    hints.push(`Synthetic batch saw ${failed} adapter failures. Check the failure reasons in the per-adapter table above.`)
  }

  return hints
}

function printSection(title: string) {
  console.log()
  console.log(`=== ${title} ===`)
}

function fmtMs(value: number | null): string {
  if (value === null) return "—"
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`
  return `${value}ms`
}

function fmtSec(value: number | null): string {
  if (value === null) return "—"
  if (value >= 3600) return `${(value / 3600).toFixed(1)}h`
  if (value >= 60) return `${(value / 60).toFixed(1)}m`
  return `${value}s`
}

async function main() {
  const args = parseArgs()

  console.log(
    `[bench] sample=${args.sample} concurrency=${args.concurrency} adapter=${args.adapterFilter ?? "all"} skipProduction=${args.skipProduction}`
  )

  let production: Awaited<ReturnType<typeof readProductionState>> | null = null
  if (!args.skipProduction) {
    try {
      production = await readProductionState()
    } catch (error) {
      console.warn(
        `[bench] could not read production state (migration applied?): ${(error as Error).message}`
      )
    }
  }

  if (production) {
    printSection("Production state")
    console.log("Per-tier:")
    for (const tier of production.tiers) {
      console.log(
        `  ${tier.freshness_tier.padEnd(10)} companies=${String(tier.companies).padStart(6)} backlog=${String(tier.backlog).padStart(5)}  freshness p50=${fmtSec(tier.p50_lag_sec).padStart(8)}  p95=${fmtSec(tier.p95_lag_sec).padStart(8)}`
      )
    }
    console.log()
    const detP50 = production.detection.p50_sec
    const detP95 = production.detection.p95_sec
    console.log(
      `Detection lag (posted_at → first_detected_at, 24h): samples=${production.detection.samples} p50=${fmtSec(detP50)} p95=${fmtSec(detP95)}`
    )
    if (detP50 !== null) {
      console.log(
        `  ${pass(`p50 ${fmtSec(detP50)} ≤ target ${fmtSec(TARGETS.detectionP50Sec)}`, detP50 <= TARGETS.detectionP50Sec)}`
      )
    }
    if (detP95 !== null) {
      console.log(
        `  ${pass(`p95 ${fmtSec(detP95)} ≤ target ${fmtSec(TARGETS.detectionP95Sec)}`, detP95 <= TARGETS.detectionP95Sec)}`
      )
    }
  }

  printSection(
    `Synthetic batch (${args.seedUrls ? `urls=${args.seedUrls.length}` : `sample=${args.sample}`})`
  )
  const sample = args.seedUrls
    ? args.seedUrls.map((url, idx) => ({
        id: `seed-${idx}`,
        name: `seed-${idx}`,
        careers_url: url,
        etag: null,
        last_modified: null,
        ats_type: null,
      }))
    : await pickSample(args.sample, args.adapterFilter)
  if (sample.length === 0) {
    console.log("No companies match the sample criteria; bench cannot run.")
    process.exit(0)
  }
  console.log(`Picked ${sample.length} companies.`)

  const limit = pLimit(args.concurrency)
  const wallStartedAt = Date.now()
  const outcomes = await Promise.all(
    sample.map((company) =>
      limit(() => {
        const detection = detectAdapter(company.careers_url)
        if (!detection) {
          return {
            adapterName: "unknown",
            durationMs: 0,
            jobsCount: 0,
            notModified: false,
            ok: false,
            reason: "no adapter matched careers_url",
          } as FetchOutcome
        }
        return timedFetch(company, detection.adapter, detection.slug)
      })
    )
  )
  const wallTimeMs = Date.now() - wallStartedAt

  const perAdapter = summariseByAdapter(outcomes)
  console.log()
  console.log("Per-adapter timings:")
  console.log(
    "  adapter         n   ok  fail  304   p50         p95         jobs"
  )
  for (const row of perAdapter) {
    console.log(
      `  ${row.adapter.padEnd(14)} ${String(row.count).padStart(3)} ${String(row.ok).padStart(4)} ${String(row.failed).padStart(5)} ${String(row.notModified).padStart(4)}   ${fmtMs(row.p50_ms).padStart(8)}  ${fmtMs(row.p95_ms).padStart(8)}   ${row.jobs}`
    )
  }

  const failures = outcomes.filter((o) => !o.ok)
  if (failures.length > 0) {
    console.log()
    console.log("Failures:")
    for (const f of failures) {
      console.log(`  ${f.adapterName.padEnd(14)} ${fmtMs(f.durationMs).padStart(8)}  ${f.reason ?? "unknown"}`)
    }
  }

  const totalCalls = outcomes.filter((o) => o.ok).length
  const effectiveCallsPerSec = wallTimeMs === 0 ? 0 : (totalCalls / wallTimeMs) * 1000
  const totalJobs = outcomes.reduce((sum, o) => sum + o.jobsCount, 0)
  console.log()
  console.log(
    `Wall time: ${(wallTimeMs / 1000).toFixed(2)}s, ATS calls: ${totalCalls}, effective rate: ${effectiveCallsPerSec.toFixed(1)} calls/sec, jobs returned: ${totalJobs}`
  )
  console.log(
    `  ${pass(`ATS calls/sec ${effectiveCallsPerSec.toFixed(1)} ≥ target ${TARGETS.atsCallsPerSec}`, effectiveCallsPerSec >= TARGETS.atsCallsPerSec)}`
  )

  if (args.persistBenchSize) {
    printSection(`Persist throughput (synthesized ${args.persistBenchSize} jobs, BEGIN/ROLLBACK)`)
    const pool = getPostgresPool()
    const companyResult = await pool.query<{ id: string; name: string | null }>(
      `SELECT id, name FROM companies WHERE ats_type IS NOT NULL ORDER BY random() LIMIT 1`
    )
    if (companyResult.rows.length === 0) {
      console.log("Skipped: no companies with ats_type set in DB.")
    } else {
      const company = companyResult.rows[0]
      const jobs: HarvestedJob[] = Array.from({ length: args.persistBenchSize }, (_, i) => ({
        externalId: `bench-${process.pid}-${Date.now()}-${i}`,
        title: `Bench Job ${i}`,
        applyUrl: `https://boards.greenhouse.io/bench/jobs/${i}`,
        description: `Synthetic description for job ${i}. `.repeat(20),
        location: "San Francisco, CA",
        postedAt: new Date(Date.now() - i * 60_000).toISOString(),
        contentHash: hashContent([`bench-${i}`, Date.now()]),
      }))

      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const t0 = Date.now()
        const outcome = await persistJobsBulk({
          pool: client,
          companyId: company.id,
          companyMeta: { name: company.name, domain: null, careersUrl: null },
          sourceAts: "greenhouse",
          sourceAtsSlug: "bench",
          crawledAt: new Date(),
          jobs,
        })
        const elapsedMs = Date.now() - t0
        await client.query("ROLLBACK")
        const jobsPerSec = elapsedMs === 0 ? Infinity : (outcome.written / elapsedMs) * 1000
        console.log(
          `Target company: ${company.name ?? "(unnamed)"} (${company.id})`
        )
        console.log(
          `Inserted: ${outcome.inserted}, updated: ${outcome.updated}, filtered: ${outcome.filteredOut}, elapsed: ${elapsedMs}ms`
        )
        console.log(`Rate: ${jobsPerSec.toFixed(0)} jobs/sec`)
        console.log(
          `  ${pass(`jobs/sec ${jobsPerSec.toFixed(0)} ≥ target ${TARGETS.jobsPerSec}`, jobsPerSec >= TARGETS.jobsPerSec)}`
        )
        console.log(`[rolled back — no data persisted]`)
      } finally {
        client.release()
      }
    }
  }

  printSection("Knob hints")
  const hints = emitHints({
    perAdapter,
    tiers: production?.tiers ?? [],
    detection: production?.detection ?? { samples: 0, p50_sec: null, p95_sec: null },
    effectiveCallsPerSec,
    wallTimeMs,
  })
  if (hints.length === 0) {
    console.log("(none) — all measured targets hit.")
  } else {
    for (const hint of hints) console.log(`- ${hint}`)
  }

  if (!args.seedUrls) await getPostgresPool().end()
}

main().catch((error) => {
  console.error("[bench] fatal:", error)
  process.exit(1)
})
