import type { Pool } from "pg"
import pLimit from "p-limit"
import { adapters, detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import {
  runAtsHarvest,
  type AtsHarvestCompany,
  type AtsHarvestOutcome,
} from "@/lib/harvester/run-harvest"

export type LimitFn = ReturnType<typeof pLimit>

/**
 * Resolve adapter name for a claimed company. Prefers the persisted
 * `ats_type` (cheap), falls back to URL detection (regex on careers_url) when
 * the company row hasn't been classified yet.
 */
export function adapterNameFor(company: AtsHarvestCompany): AtsName | null {
  if (company.ats_type) {
    const known = SUPPORTED_ATS_TYPES.find((n) => n === company.ats_type)
    if (known) return known as AtsName
  }
  const detectionUrl = company.direct_ats_url?.trim() || company.careers_url
  const detection = detectAdapter(detectionUrl)
  return (detection?.adapter.name as AtsName | undefined) ?? null
}

/**
 * Build a `Map<AtsName, Limit>` from the adapter registry. Each adapter's
 * declared concurrency overrides the default; unset → fall back to the
 * worker's `defaultConcurrency`. A `__fallback__` slot covers companies that
 * route to an unknown adapter (shouldn't happen given the claim filter, but
 * defensive).
 */
export function buildAdapterLimits(defaultConcurrency: number): {
  byAdapter: Map<AtsName, LimitFn>
  fallback: LimitFn
} {
  const byAdapter = new Map<AtsName, LimitFn>()
  for (const [name, adapter] of Object.entries(adapters)) {
    if (!adapter) continue
    byAdapter.set(name as AtsName, pLimit(adapter.concurrency ?? defaultConcurrency))
  }
  return { byAdapter, fallback: pLimit(defaultConcurrency) }
}

export type WorkerConfig = {
  tickIntervalMs: number
  claimBatchSize: number
  leaseSeconds: number
  concurrency: number
}

export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env
): WorkerConfig {
  const intPositive = (raw: string | undefined, fallback: number, min = 1) => {
    const parsed = Number.parseInt(raw ?? "", 10)
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback
  }
  return {
    tickIntervalMs: intPositive(env.HARVESTER_TICK_INTERVAL_MS, 30_000, 500),
    // Lowered from 50 → 20. Production logs from PR #60 showed each tick
    // taking 5–6 minutes because slow per-company adapters (Apple = 1,
    // infosys = 1, iCIMS = 3, Workday = 4) serialize when several land
    // in the same batch. Smaller batch keeps each tick around 2 min so
    // the lease still covers it and Coolify's health checks don't flag
    // the worker as unresponsive.
    claimBatchSize: intPositive(env.HARVESTER_CLAIM_BATCH_SIZE, 20),
    // Bumped 120 → 240 to give a worst-case slightly-slow tick room
    // before the lease expires and companies get re-claimed.
    leaseSeconds: intPositive(env.HARVESTER_LEASE_SECONDS, 240),
    concurrency: intPositive(env.HARVESTER_CONCURRENCY, 8),
  }
}

export type TickSummary = {
  claimed: number
  succeeded: number
  failed: number
  notModified: number
  newJobs: number
  durationMs: number
  failedByAdapter?: Record<string, number>
  failedByReason?: Record<string, number>
}

const CLAIM_QUERY = `
UPDATE companies
SET next_harvest_at = now() + ($2 || ' seconds')::interval
WHERE id IN (
  SELECT id FROM companies
  WHERE status = 'active'
    AND is_active = true
    AND duplicate_of_company_id IS NULL
    AND careers_url IS NOT NULL
    AND (
      ats_type = ANY($3::text[])
      OR careers_url ILIKE 'https://boards.greenhouse.io/%'
      OR careers_url ILIKE 'https://job-boards.greenhouse.io/%'
      OR careers_url ILIKE 'https://jobs.lever.co/%'
      OR careers_url ILIKE 'https://jobs.ashbyhq.com/%'
      OR careers_url ILIKE 'https://jobs.smartrecruiters.com/%'
      OR careers_url ILIKE 'https://careers.smartrecruiters.com/%'
      OR careers_url ILIKE 'https://apply.workable.com/%'
      OR careers_url ILIKE 'https://jobs.workable.com/%'
      OR careers_url ~* '^https?://[a-z0-9-]+\.wd[0-9]{1,3}\.myworkdayjobs\.com/'
      OR careers_url ~* '^https?://[a-z0-9-]+\.recruitee\.com/'
      OR careers_url ~* '^https?://[a-z0-9-]+\.teamtailor\.com/'
      OR careers_url ~* '^https?://[a-z0-9-]+\.jobs\.personio\.(com|de)/'
      OR careers_url ~* '^https?://[a-z0-9-]+\.bamboohr\.com/'
      OR careers_url ~* '^https?://[a-z0-9-]+\.applytojob\.com/'
      OR careers_url ILIKE 'https://digitalcareers.infosys.com/%'
      OR careers_url ILIKE 'https://jobs.apple.com/%'
      OR direct_ats_url ILIKE 'https://boards.greenhouse.io/%'
      OR direct_ats_url ILIKE 'https://job-boards.greenhouse.io/%'
      OR direct_ats_url ILIKE 'https://jobs.lever.co/%'
      OR direct_ats_url ILIKE 'https://jobs.ashbyhq.com/%'
      OR direct_ats_url ILIKE 'https://jobs.smartrecruiters.com/%'
      OR direct_ats_url ILIKE 'https://careers.smartrecruiters.com/%'
      OR direct_ats_url ILIKE 'https://apply.workable.com/%'
      OR direct_ats_url ILIKE 'https://jobs.workable.com/%'
      OR direct_ats_url ~* '^https?://[a-z0-9-]+\.wd[0-9]{1,3}\.myworkdayjobs\.com/'
      OR direct_ats_url ~* '^https?://[a-z0-9-]+\.recruitee\.com/'
      OR direct_ats_url ~* '^https?://[a-z0-9-]+\.teamtailor\.com/'
      OR direct_ats_url ~* '^https?://[a-z0-9-]+\.jobs\.personio\.(com|de)/'
      OR direct_ats_url ~* '^https?://[a-z0-9-]+\.bamboohr\.com/'
      OR direct_ats_url ~* '^https?://[a-z0-9-]+\.applytojob\.com/'
      OR direct_ats_url ILIKE 'https://digitalcareers.infosys.com/%'
      OR direct_ats_url ILIKE 'https://jobs.apple.com/%'
    )
    AND (next_harvest_at IS NULL OR next_harvest_at <= now())
  -- Sort by overdueness only. Tier still controls cadence via the interval
  -- written to next_harvest_at after each crawl; a strict tier CASE here
  -- starved tier_2/tier_3 because tier_1's backlog never cleared.
  ORDER BY next_harvest_at ASC NULLS FIRST
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, name, careers_url, direct_ats_url, domain, ats_type, raw_ats_config, etag, last_modified, freshness_tier
`

const SUPPORTED_ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "workday",
  "recruitee",
  "teamtailor",
  "personio",
  "bamboohr",
  "jazzhr",
  "icims",
  "infosys",
  "apple",
]

type ClaimedRow = {
  id: string
  name: string
  careers_url: string
  direct_ats_url: string | null
  domain: string | null
  ats_type: string | null
  raw_ats_config: Record<string, unknown> | null
  etag: string | null
  last_modified: string | null
  freshness_tier: string | null
}

type TickCompanyOutcome = {
  companyId: string
  outcome: AtsHarvestOutcome
}

function incrementCount(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1
}

function topCounts(source: Record<string, number>, limit = 6): Record<string, number> {
  return Object.fromEntries(
    Object.entries(source)
      .sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1]
        return a[0].localeCompare(b[0])
      })
      .slice(0, limit)
  )
}

function summarizeFailureReason(message: string | null): string {
  if (!message) return "unknown"
  const trimmed = message.replace(/\s+/g, " ").trim()
  const lower = trimmed.toLowerCase()
  const statusMatch = lower.match(/\bhttp[_\s-]?(\d{3})\b/)
  if (statusMatch) return `http_${statusMatch[1]}`
  if (lower.includes("timeout") || lower.includes("abort")) return "timeout"
  if (lower.includes("fetch_error") || lower.includes("fetch failed")) return "fetch_error"
  if (lower.includes("econnreset") || lower.includes("socket hang up")) return "socket_error"
  if (lower.includes("enotfound") || lower.includes("eai_again") || lower.includes("dns")) return "dns_error"
  if (lower.includes("too many requests") || lower.includes("rate limit")) return "rate_limited"
  if (lower.includes("forbidden") || lower.includes("blocked")) return "blocked"
  return trimmed.slice(0, 80)
}

function crawlLogErrorMessage(outcome: Exclude<AtsHarvestOutcome, { matched: false }>): string | null {
  if (outcome.notModified) {
    return `not_modified (upstream ${outcome.upstreamLatencyMs}ms)`
  }
  return outcome.errorMessage
}

async function insertTickCrawlLogsSafe(pool: Pool, outcomes: TickCompanyOutcome[]) {
  const rows = outcomes.flatMap((entry) => {
    if (!entry.outcome.matched) return []
    const outcome = entry.outcome
    return [{
      companyId: entry.companyId,
      status: outcome.status,
      jobsFound: outcome.jobsFound,
      newJobs: outcome.newJobs,
      durationMs: outcome.durationMs,
      crawledAtIso: outcome.crawledAtIso,
      errorMessage: crawlLogErrorMessage(outcome),
    }]
  })

  if (rows.length === 0) return

  const values: Array<string | number | null> = []
  const tuples = rows.map((row, idx) => {
    const offset = idx * 7
    values.push(
      row.companyId,
      row.status,
      row.jobsFound,
      row.newJobs,
      row.durationMs,
      row.crawledAtIso,
      row.errorMessage
    )
    return `($${offset + 1}::uuid, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}::timestamptz, $${offset + 7})`
  })

  try {
    await pool.query(
      `INSERT INTO crawl_logs (company_id, status, jobs_found, new_jobs, duration_ms, crawled_at, error_message)
       VALUES ${tuples.join(", ")}`,
      values
    )
  } catch {
    // Keep the harvest loop resilient even when log persistence is unavailable.
  }
}

export async function claimEligibleCompanies(
  pool: Pool,
  batchSize: number,
  leaseSeconds: number
): Promise<AtsHarvestCompany[]> {
  const { rows } = await pool.query<ClaimedRow>(CLAIM_QUERY, [
    batchSize,
    leaseSeconds,
    SUPPORTED_ATS_TYPES,
  ])
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    careers_url: row.careers_url,
    direct_ats_url: row.direct_ats_url,
    domain: row.domain,
    ats_type: row.ats_type,
    raw_ats_config: row.raw_ats_config,
    etag: row.etag,
    last_modified: row.last_modified,
    freshness_tier: row.freshness_tier,
  }))
}

export async function runTick(
  pool: Pool,
  config: WorkerConfig,
  limits: { byAdapter: Map<AtsName, LimitFn>; fallback: LimitFn } = buildAdapterLimits(
    config.concurrency
  )
): Promise<TickSummary> {
  const startedAt = Date.now()
  const companies = await claimEligibleCompanies(pool, config.claimBatchSize, config.leaseSeconds)

  if (companies.length === 0) {
    return {
      claimed: 0,
      succeeded: 0,
      failed: 0,
      notModified: 0,
      newJobs: 0,
      durationMs: Date.now() - startedAt,
    }
  }

  const results: TickCompanyOutcome[] = await Promise.all(
    companies.map((company) => {
      const adapterName = adapterNameFor(company)
      const limit = adapterName ? limits.byAdapter.get(adapterName) ?? limits.fallback : limits.fallback
      return limit(async () => ({
        companyId: company.id,
        outcome: await runAtsHarvest({ pool, company }),
      }))
    })
  )

  let succeeded = 0
  let failed = 0
  let notModified = 0
  let newJobs = 0
  const failedByAdapter: Record<string, number> = {}
  const failedByReason: Record<string, number> = {}

  for (const { outcome } of results) {
    const r = outcome
    if (!r.matched) {
      // claimed by tier filter but adapter didn't match — treat as failed so the lease expires naturally
      failed += 1
      incrementCount(failedByAdapter, "adapter_mismatch")
      incrementCount(failedByReason, "adapter_mismatch")
      continue
    }
    if (r.status === "failed") {
      failed += 1
      incrementCount(failedByAdapter, r.adapter)
      incrementCount(failedByReason, summarizeFailureReason(r.errorMessage))
    } else {
      succeeded += 1
    }
    if (r.notModified) notModified += 1
    newJobs += r.newJobs
  }

  await insertTickCrawlLogsSafe(pool, results)

  const failedAdapterTop = failed > 0 ? topCounts(failedByAdapter) : undefined
  const failedReasonTop = failed > 0 ? topCounts(failedByReason) : undefined

  return {
    claimed: companies.length,
    succeeded,
    failed,
    notModified,
    newJobs,
    durationMs: Date.now() - startedAt,
    ...(failedAdapterTop ? { failedByAdapter: failedAdapterTop } : {}),
    ...(failedReasonTop ? { failedByReason: failedReasonTop } : {}),
  }
}

export type WorkerLogger = (msg: string, fields?: Record<string, unknown>) => void

const defaultLogger: WorkerLogger = (msg, fields) => {
  if (fields && Object.keys(fields).length > 0) {
    console.log(`[harvester] ${msg} ${JSON.stringify(fields)}`)
  } else {
    console.log(`[harvester] ${msg}`)
  }
}

export type WorkerLoopHandle = {
  stop: () => void
  done: Promise<void>
}

export function startWorkerLoop(
  pool: Pool,
  config: WorkerConfig,
  options: { logger?: WorkerLogger } = {}
): WorkerLoopHandle {
  const log = options.logger ?? defaultLogger
  const limits = buildAdapterLimits(config.concurrency)
  let stopping = false
  let resolveDone: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const loop = async () => {
    log("started", {
      tickMs: config.tickIntervalMs,
      batch: config.claimBatchSize,
      leaseSec: config.leaseSeconds,
      defaultConcurrency: config.concurrency,
      perAdapter: Object.fromEntries(
        [...limits.byAdapter.entries()].map(([name, _]) => [
          name,
          adapters[name]?.concurrency ?? config.concurrency,
        ])
      ),
    })

    // Track memory delta across ticks so a leak is visible in the log stream.
    // We've been losing the worker to silent crashes after a few hours; if RSS
    // climbs monotonically each tick, that's the smoking gun.
    let lastRssMb = process.memoryUsage().rss / 1024 / 1024

    while (!stopping) {
      const tickStartedAt = Date.now()
      try {
        const summary = await runTick(pool, config, limits)
        if (summary.claimed > 0) {
          const mem = process.memoryUsage()
          const rssMb = mem.rss / 1024 / 1024
          const heapMb = mem.heapUsed / 1024 / 1024
          // @ts-expect-error process._getActiveHandles is undocumented but stable
          const handles = typeof process._getActiveHandles === "function"
            // @ts-expect-error see above
            ? process._getActiveHandles().length
            : null
          log("tick", {
            ...summary,
            rssMb: Math.round(rssMb),
            rssDeltaMb: Math.round(rssMb - lastRssMb),
            heapMb: Math.round(heapMb),
            handles,
          })
          lastRssMb = rssMb
        }
      } catch (error) {
        log("tick_error", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5).join("\n") : undefined,
        })
      }

      if (stopping) break

      const elapsed = Date.now() - tickStartedAt
      const remaining = Math.max(0, config.tickIntervalMs - elapsed)
      if (remaining > 0) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, remaining)
          // Allow process exit if SIGINT arrives mid-sleep:
          t.unref?.()
        })
      }
    }

    log("stopped")
    resolveDone()
  }

  void loop()

  return {
    stop: () => {
      stopping = true
    },
    done,
  }
}
