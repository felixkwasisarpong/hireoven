import type { Pool } from "pg"
import pLimit from "p-limit"
import { adapters, detectAdapter, type AtsName } from "@/lib/harvester/adapters"
import { isBlockedAtsSource, isBlockedAtsUrl } from "@/lib/harvester/ats-blocklist"
import {
  runAtsHarvest,
  type AtsHarvestCompany,
  type AtsHarvestOutcome,
} from "@/lib/harvester/run-harvest"

export type LimitFn = ReturnType<typeof pLimit>
export type AdapterLimits = {
  byAdapter: Map<AtsName, LimitFn>
  fallback: LimitFn
}

/**
 * Resolve adapter name for a claimed company. Prefers the persisted
 * `ats_type` (cheap), falls back to URL detection (regex on careers_url) when
 * the company row hasn't been classified yet.
 */
export function adapterNameFor(company: AtsHarvestCompany): AtsName | null {
  // Skip blocklisted aggregator tenants even if a stale row still has ats_type set.
  if (isBlockedAtsSource(company.ats_type, company.ats_identifier)) return null
  const detectionUrl = company.direct_ats_url?.trim() || company.careers_url
  if (isBlockedAtsUrl(detectionUrl)) return null

  if (company.ats_type) {
    const known = SUPPORTED_ATS_TYPES.find((n) => n === company.ats_type)
    if (known) return known as AtsName
  }
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
export function buildAdapterLimits(defaultConcurrency: number): AdapterLimits {
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

const MAX_CLAIM_BATCH_SIZE = 40
const MAX_DEFAULT_CONCURRENCY = 12
const DEFAULT_TOTAL_CLAIM_BUDGET = 24
const MAX_TOTAL_CLAIM_BUDGET = 80

export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env
): WorkerConfig {
  const intPositive = (raw: string | undefined, fallback: number, min = 1, max?: number) => {
    const parsed = Number.parseInt(raw ?? "", 10)
    if (!Number.isFinite(parsed) || parsed < min) return fallback
    return max ? Math.min(parsed, max) : parsed
  }
  return {
    tickIntervalMs: intPositive(env.HARVESTER_TICK_INTERVAL_MS, 30_000, 500),
    // Lowered from 50 → 20. Production logs from PR #60 showed each tick
    // taking 5–6 minutes because slow per-company adapters (Apple = 1,
    // infosys = 1, iCIMS = 3, Workday = 4) serialize when several land
    // in the same batch. Smaller batch keeps each tick around 2 min so
    // the lease still covers it and Coolify's health checks don't flag
    // the worker as unresponsive.
    claimBatchSize: intPositive(env.HARVESTER_CLAIM_BATCH_SIZE, 20, 1, MAX_CLAIM_BATCH_SIZE),
    // Bumped 120 → 240 to give a worst-case slightly-slow tick room
    // before the lease expires and companies get re-claimed.
    leaseSeconds: intPositive(env.HARVESTER_LEASE_SECONDS, 240),
    concurrency: intPositive(env.HARVESTER_CONCURRENCY, 8, 1, MAX_DEFAULT_CONCURRENCY),
  }
}

export function scaleWorkerConfigForLoops(
  config: WorkerConfig,
  loopCount: number,
  env: Record<string, string | undefined> = process.env
): WorkerConfig {
  const loops = Math.max(1, Math.floor(loopCount))
  const rawBudget = Number.parseInt(env.HARVESTER_TOTAL_CLAIM_BUDGET ?? "", 10)
  const totalBudget = Number.isFinite(rawBudget) && rawBudget >= loops
    ? Math.min(rawBudget, MAX_TOTAL_CLAIM_BUDGET)
    : DEFAULT_TOTAL_CLAIM_BUDGET
  const perLoopBatch = Math.max(1, Math.min(config.claimBatchSize, Math.ceil(totalBudget / loops)))
  return { ...config, claimBatchSize: perLoopBatch }
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

const DEFAULT_PER_COMPANY_TIMEOUT_MS = 60_000
const PER_COMPANY_TIMEOUT_MIN_MS = 5_000
const PER_COMPANY_TIMEOUT_BY_ADAPTER: Partial<Record<AtsName, number>> = {
  workday: 60_000,
  workable: 90_000, // list + a v2 detail-fetch budget for boards that omit the JD
  smartrecruiters: 45_000,
  ashby: 60_000,
  usajobs: 60_000,
  icims: 60_000,
  apple: 120_000,
  amazon: 150_000, // paginates up to 100 pages of the amazon.jobs API per tick
  microsoft: 240_000, // ~146 search pages (10/page) + a detail-fetch budget
  netflix: 120_000, // ~52 list pages (10/page, Eightfold) + a detail-fetch budget
}

function parseTimeoutMs(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10)
  if (Number.isFinite(parsed) && parsed >= PER_COMPANY_TIMEOUT_MIN_MS) return parsed
  return fallback
}

export function resolvePerCompanyTimeoutMs(
  adapterName: AtsName | null,
  env: Record<string, string | undefined> = process.env
): number {
  const globalTimeoutMs = parseTimeoutMs(
    env.HARVESTER_PER_COMPANY_TIMEOUT_MS,
    DEFAULT_PER_COMPANY_TIMEOUT_MS
  )
  if (!adapterName) return globalTimeoutMs

  const adapterEnvKey = `HARVESTER_PER_COMPANY_TIMEOUT_${adapterName.toUpperCase()}_MS`
  const adapterEnvRaw = env[adapterEnvKey]
  if (adapterEnvRaw) return parseTimeoutMs(adapterEnvRaw, globalTimeoutMs)

  const adapterDefault = PER_COMPANY_TIMEOUT_BY_ADAPTER[adapterName]
  if (!adapterDefault) return globalTimeoutMs
  return Math.max(globalTimeoutMs, adapterDefault)
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
      OR careers_url ILIKE 'https://jobs.jobvite.com/%'
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
      OR direct_ats_url ILIKE 'https://jobs.jobvite.com/%'
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
RETURNING id, name, careers_url, direct_ats_url, domain, ats_type, ats_identifier, raw_ats_config, etag, last_modified, freshness_tier, consecutive_empty_crawls
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
  "jobvite",
  "icims",
  "successfactors",
  "taleo",
  "oraclecloud",
  "usajobs",
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
  ats_identifier: string | null
  raw_ats_config: Record<string, unknown> | null
  etag: string | null
  last_modified: string | null
  freshness_tier: string | null
  consecutive_empty_crawls: number | null
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

function failedTickOutcome(args: {
  company: AtsHarvestCompany
  adapterName: AtsName | null
  message: string
  durationMs: number
}): TickCompanyOutcome {
  return {
    companyId: args.company.id,
    outcome: {
      matched: true,
      status: "failed",
      jobsFound: 0,
      newJobs: 0,
      durationMs: args.durationMs,
      errorMessage: args.message,
      crawledAtIso: new Date().toISOString(),
      adapter: args.adapterName ?? "unknown",
      upstreamLatencyMs: args.durationMs,
      notModified: false,
    },
  }
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
    ats_identifier: row.ats_identifier,
    raw_ats_config: row.raw_ats_config,
    etag: row.etag,
    last_modified: row.last_modified,
    freshness_tier: row.freshness_tier,
    consecutive_empty_crawls: row.consecutive_empty_crawls,
  }))
}

export async function runTick(
  pool: Pool,
  config: WorkerConfig,
  limits: AdapterLimits = buildAdapterLimits(config.concurrency),
  options: { signal?: AbortSignal; env?: Record<string, string | undefined> } = {}
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

  // Per-company timeout — caps any single runAtsHarvest call that hangs
  // because its adapter's fetch / Playwright / DB call never propagates
  // an abort. Without this, one stuck promise wedges the entire Promise.all
  // and the tick-level watchdog has to fire (losing every other company's
  // work in the batch). With it, the hung company resolves to a synthesized
  // "failed" outcome so the rest of the batch completes normally, the
  // crawl_logs row records the timeout, and we get a `company_hang` log line
  // that names the culprit for later adapter fixes.
  const results: TickCompanyOutcome[] = await Promise.all(
    companies.map((company) => {
      const adapterName = adapterNameFor(company)
      const perCompanyTimeoutMs = resolvePerCompanyTimeoutMs(adapterName, options.env)
      const limit = adapterName ? limits.byAdapter.get(adapterName) ?? limits.fallback : limits.fallback
      return limit(async () => {
        if (options.signal?.aborted) {
          return failedTickOutcome({
            company,
            adapterName,
            message: "tick timeout aborted company before start",
            durationMs: Date.now() - startedAt,
          })
        }
        const controller = new AbortController()
        let parentAbortListener: (() => void) | undefined
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined
        const parentSignal = options.signal
        const parentAbortPromise = parentSignal
          ? new Promise<TickCompanyOutcome>((resolve) => {
              const onAbort = () => {
                controller.abort(parentSignal.reason)
                resolve(failedTickOutcome({
                  company,
                  adapterName,
                  message: "tick timeout aborted company before completion",
                  durationMs: Date.now() - startedAt,
                }))
              }
              if (parentSignal.aborted) {
                onAbort()
                return
              }
              parentSignal.addEventListener("abort", onAbort, { once: true })
              parentAbortListener = () => parentSignal.removeEventListener("abort", onAbort)
            })
          : null
        const timeoutPromise = new Promise<TickCompanyOutcome>((resolve) => {
          timeoutHandle = setTimeout(() => {
            const message = `per-company timeout ${perCompanyTimeoutMs}ms`
            controller.abort(new Error(message))
            // Name the culprit so we can ship a real adapter-level fix.
            // runTick is exported standalone and doesn't have the loop's logger
            // wired in, so emit via console directly using the same format.
            console.log(`[harvester] company_hang ${JSON.stringify({
              companyId: company.id,
              name: company.name,
              adapter: adapterName ?? "unknown",
              ats_type: company.ats_type,
              careers_url: company.careers_url,
              direct_ats_url: company.direct_ats_url ?? null,
            })}`)
            resolve(failedTickOutcome({ company, adapterName, message, durationMs: perCompanyTimeoutMs }))
          }, perCompanyTimeoutMs)
          timeoutHandle.unref?.()
        })
        const workPromise = runAtsHarvest({ pool, company, signal: controller.signal }).then((outcome) => ({
          companyId: company.id,
          outcome,
        }))
        try {
          const racers = parentAbortPromise
            ? [workPromise, timeoutPromise, parentAbortPromise]
            : [workPromise, timeoutPromise]
          return await Promise.race(racers)
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          parentAbortListener?.()
        }
      })
    })
  )

  let succeeded = 0
  let failed = 0
  let notModified = 0
  let newJobs = 0
  const failedByAdapter: Record<string, number> = {}
  const failedByReason: Record<string, number> = {}
  const mismatchedIds: string[] = []

  for (const { companyId, outcome } of results) {
    const r = outcome
    if (!r.matched) {
      // claimed by tier filter but adapter didn't match — push next_harvest_at
      // out so the company isn't immediately re-claimed on the next tick.
      mismatchedIds.push(companyId)
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

  if (mismatchedIds.length > 0) {
    await pool
      .query(
        `UPDATE companies SET next_harvest_at = now() + interval '6 hours' WHERE id = ANY($1::uuid[])`,
        [mismatchedIds]
      )
      .catch(() => {})
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
  options: { logger?: WorkerLogger; limits?: AdapterLimits } = {}
): WorkerLoopHandle {
  const log = options.logger ?? defaultLogger
  const limits = options.limits ?? buildAdapterLimits(config.concurrency)
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

    // Hard ceiling per tick. When it fires, abort the current tick's signal so
    // queued/active adapter work drains instead of starting a second overlapping
    // tick on top of the stuck one.
    const tickTimeoutMs = Math.max(
      60_000,
      Number.parseInt(process.env.HARVESTER_TICK_TIMEOUT_MS ?? "300000", 10)
    )

    while (!stopping) {
      const tickStartedAt = Date.now()
      const tickController = new AbortController()
      let tickTimedOut = false
      const tickTimeout = setTimeout(() => {
        tickTimedOut = true
        const message = `tick exceeded ${tickTimeoutMs}ms — aborting stuck batch`
        log("tick_timeout", { message })
        tickController.abort(new Error(message))
      }, tickTimeoutMs)
      tickTimeout.unref?.()
      try {
        const summary = await runTick(pool, config, limits, { signal: tickController.signal })
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
            ...(tickTimedOut ? { abortedByWatchdog: true } : {}),
          })
          lastRssMb = rssMb
        }
      } catch (error) {
        log("tick_error", {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack?.split("\n").slice(0, 5).join("\n") : undefined,
        })
      } finally {
        clearTimeout(tickTimeout)
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
