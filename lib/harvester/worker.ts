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
  const detection = detectAdapter(company.careers_url)
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
}

const CLAIM_QUERY = `
UPDATE companies
SET next_harvest_at = now() + ($2 || ' seconds')::interval
WHERE id IN (
  SELECT id FROM companies
  WHERE status = 'active'
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
    )
    AND (next_harvest_at IS NULL OR next_harvest_at <= now())
  ORDER BY
    CASE COALESCE(freshness_tier, 'tier_2')
      WHEN 'tier_1' THEN 0
      WHEN 'tier_2' THEN 1
      WHEN 'tier_3' THEN 2
      WHEN 'tier_dead' THEN 3
      ELSE 1
    END,
    next_harvest_at ASC NULLS FIRST
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, name, careers_url, domain, ats_type, raw_ats_config, etag, last_modified, freshness_tier
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
  domain: string | null
  ats_type: string | null
  raw_ats_config: Record<string, unknown> | null
  etag: string | null
  last_modified: string | null
  freshness_tier: string | null
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

  const results: AtsHarvestOutcome[] = await Promise.all(
    companies.map((company) => {
      const adapterName = adapterNameFor(company)
      const limit = adapterName ? limits.byAdapter.get(adapterName) ?? limits.fallback : limits.fallback
      return limit(() => runAtsHarvest({ pool, company }))
    })
  )

  let succeeded = 0
  let failed = 0
  let notModified = 0
  let newJobs = 0
  for (const r of results) {
    if (!r.matched) {
      // claimed by tier filter but adapter didn't match — treat as failed so the lease expires naturally
      failed += 1
      continue
    }
    if (r.status === "failed") failed += 1
    else succeeded += 1
    if (r.notModified) notModified += 1
    newJobs += r.newJobs
  }

  return {
    claimed: companies.length,
    succeeded,
    failed,
    notModified,
    newJobs,
    durationMs: Date.now() - startedAt,
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
