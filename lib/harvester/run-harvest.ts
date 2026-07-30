import type { Pool } from "pg"
import { detectAdapter, getAdapter, type AtsAdapter, type AtsName } from "@/lib/harvester/adapters"
import { throwIfAborted } from "@/lib/harvester/adapters/_base"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { persistJobsBulk } from "@/lib/harvester/persist-bulk"
import { triggerInstantNotify } from "@/lib/alerts/notify-trigger"

const TIER_INTERVAL_DEFAULTS: Record<string, number> = {
  tier_1: 180,        // 3 min — active sponsors / always-fresh boards
  // tier_2 was 30 min. With 968 quiet greenhouse companies in tier_2 we were
  // hammering them ~2x/hr just to receive a 304-unchanged each time (3,432
  // wasted ETag checks observed in a single 78-minute window). 1 hr cuts that
  // in half without measurably delaying new-job pickup. Override per env
  // (HARVESTER_TIER_2_INTERVAL_SEC) if you need to tighten back temporarily.
  tier_2: 3_600,      // 1 hr
  tier_3: 21_600,     // 6 hr
  // Was 7 days — a board that kept coming back empty even at tier_3's 6h
  // cadence got backed off hard to avoid wasting cycles on a likely-dead
  // source. But that meant ~37% of the active company base (20k+ boards)
  // structurally never got touched within 24h. Tightened to a once-daily
  // cheap check-in instead: these boards are typically fast to crawl anyway
  // (few/no postings means pagination exits after page 1), and worker.ts
  // gives tier_dead its own small reserved claim lane so this daily check-in
  // volume can't crowd out tier_1/2/3's existing claim budget.
  tier_dead: 82_800,  // 23 hr — under the 24h SLA with headroom
}

const TIER_INTERVAL_ENV: Record<string, string> = {
  tier_1: "HARVESTER_TIER_1_INTERVAL_SEC",
  tier_2: "HARVESTER_TIER_2_INTERVAL_SEC",
  tier_3: "HARVESTER_TIER_3_INTERVAL_SEC",
  tier_dead: "HARVESTER_TIER_DEAD_INTERVAL_SEC",
}

const DEFAULT_FAILURE_COOLDOWN_SEC = 1_800
const DEFAULT_RATE_LIMIT_COOLDOWN_SEC = 900
const DEFAULT_HTTP_403_COOLDOWN_SEC = 21_600
const DEFAULT_HTTP_404_COOLDOWN_SEC = 604_800 // 7 days — board is gone
const DEFAULT_MAX_VISIT_INTERVAL_SEC = 82_800 // 23h — keeps active boards under a 24h visit SLA.
const ADAPTER_REQUEST_TIMEOUT_MS: Partial<Record<AtsName, number>> = {
  // Slower APIs and large boards often breach the generic 8s transport timeout.
  workday: 20_000,
  smartrecruiters: 12_000,
  // Ashby boards are large (3-11 MB JSON). The request timeout also gates the
  // body read (the abort timer clears only after json() resolves), so big
  // boards need headroom — measured single fetches run 0.5-5s, but gzip-decode
  // + parse of an 11 MB body under load stretches well past 25s. 40s + the
  // lowered concurrency (4) clears the 7k+/3d timeout backlog. One-shot, no
  // retries (retrying a slow server doesn't speed it up).
  ashby: 40_000,
  usajobs: 20_000,
  icims: 15_000,
  // Workable's API is slow under CONTENTION, not rate-limited: isolated calls
  // run ~300ms, but concurrent harvest load stretches the tail well past the
  // ceiling (8s → 2k+ timeouts/day; 20s → ~110/6h). Crucially the residual
  // failures are pure `timeout` with ZERO 429/403 — Workable isn't blocking us,
  // so the fix is headroom for the slow tail, not backing off. 28s absorbs more
  // of that tail while staying well inside the 180s per-company watchdog (3
  // list retries + the detail pass still fit). Overridable via
  // HARVESTER_WORKABLE_REQUEST_TIMEOUT_MS.
  workable: 28_000,
  // OracleCloud REST pages can be large; 8s isn't enough for slower tenants.
  oraclecloud: 25_000,
  // Personio and JSONLD endpoints have variable latency; give them headroom.
  personio: 15_000,
  sitemapjsonld: 20_000,
  // TikTok paginates up to 20 pages — give each fetch call time to respond.
  tiktok: 30_000,
}

function tierIntervalSeconds(
  tier: string | null,
  env: Record<string, string | undefined> = process.env
): number {
  const key = tier && tier in TIER_INTERVAL_DEFAULTS ? tier : "tier_2"
  const envName = TIER_INTERVAL_ENV[key]
  const raw = Number.parseInt(env[envName] ?? "", 10)
  if (Number.isFinite(raw) && raw >= 60) return raw
  return TIER_INTERVAL_DEFAULTS[key]
}

function maxVisitIntervalSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.HARVESTER_MAX_VISIT_INTERVAL_SEC ?? "", 10)
  if (Number.isFinite(raw) && raw >= 3_600) return raw
  return DEFAULT_MAX_VISIT_INTERVAL_SEC
}

// Legacy yield backoff ceiling. `resolveHarvestIntervalSec` applies the stricter
// visit-SLA clamp below before scheduling the next attempt.
const YIELD_MAX_INTERVAL_SEC = 604_800

/**
 * Stretch a board's base interval when it keeps coming back empty. This is the
 * compute-waste guard the `consecutive_empty_crawls` column was added for:
 * quiet ETag boards that return 304/empty every poll back off geometrically
 * instead of burning a tier_1 slot every 3 minutes forever. A single non-empty
 * crawl resets the streak (see updateCompanyHarvestState), so a board that
 * starts posting again snaps right back to its tier cadence.
 */
export function yieldAdjustedInterval(baseSec: number, consecutiveEmptyCrawls: number): number {
  const empties = Math.max(0, consecutiveEmptyCrawls)
  let multiplier = 1
  if (empties >= 20) multiplier = 8
  else if (empties >= 10) multiplier = 4
  else if (empties >= 5) multiplier = 2
  return Math.min(baseSec * multiplier, YIELD_MAX_INTERVAL_SEC)
}

function failureCooldownSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.HARVESTER_FAILURE_COOLDOWN_SECONDS ?? "", 10)
  if (Number.isFinite(raw) && raw >= 60) return raw
  return DEFAULT_FAILURE_COOLDOWN_SEC
}

function http403CooldownSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.HARVESTER_HTTP_403_COOLDOWN_SECONDS ?? "", 10)
  if (Number.isFinite(raw) && raw >= 300) return raw
  return DEFAULT_HTTP_403_COOLDOWN_SEC
}

function rateLimitCooldownSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.HARVESTER_RATE_LIMIT_COOLDOWN_SECONDS ?? "", 10)
  if (Number.isFinite(raw) && raw >= 60) return raw
  return DEFAULT_RATE_LIMIT_COOLDOWN_SEC
}

function http404CooldownSeconds(env: Record<string, string | undefined> = process.env): number {
  const raw = Number.parseInt(env.HARVESTER_HTTP_404_COOLDOWN_SECONDS ?? "", 10)
  if (Number.isFinite(raw) && raw >= 300) return raw
  return DEFAULT_HTTP_404_COOLDOWN_SEC
}

function isHttp403Error(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes("http_403") || lower.includes("http 403") || lower.includes("forbidden")
}

function isHttp404Error(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes("http_404") || lower.includes("http 404") || lower.includes("not found")
}

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes("http_429") ||
    lower.includes("http 429") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit")
}

// 422 from Workday CXS means the {tenant}:{wd}:{site} slug no longer maps to a
// servable board — the tenant gated/moved/renamed its site and no shard or
// candidate site resolves (verified: resolveWorkdaySite returns null and every
// shard 422s). It's not transient, so treat it like 404 "gone" and park it on
// the long cooldown instead of retrying every failure-cooldown window.
function isHttp422Error(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes("http_422") || lower.includes("http 422") || lower.includes("unprocessable")
}

function adapterRequestTimeoutMs(
  adapter: AtsName,
  env: Record<string, string | undefined> = process.env
): number | undefined {
  const envKey = `HARVESTER_${adapter.toUpperCase()}_REQUEST_TIMEOUT_MS`
  const envRaw = Number.parseInt(env[envKey] ?? "", 10)
  if (Number.isFinite(envRaw) && envRaw >= 1_000) return envRaw
  return ADAPTER_REQUEST_TIMEOUT_MS[adapter]
}

export type AtsHarvestCompany = {
  id: string
  name: string
  careers_url: string
  direct_ats_url?: string | null
  domain: string | null
  ats_type: string | null
  ats_identifier?: string | null
  raw_ats_config: Record<string, unknown> | null
  etag: string | null
  last_modified: string | null
  freshness_tier: string | null
  consecutive_empty_crawls?: number | null
}

function detectCompanyAdapter(
  company: AtsHarvestCompany
): { adapter: AtsAdapter; slug: string } | null {
  const detectionUrl = company.direct_ats_url?.trim() || company.careers_url
  const fromUrl = detectAdapter(detectionUrl)
  if (fromUrl) return fromUrl

  const atsType = company.ats_type?.trim()
  const atsIdentifier = company.ats_identifier?.trim()

  if (atsType && atsIdentifier) {
    const canonicalUrl = canonicalCareersUrl(atsType as AtsName, atsIdentifier)
    if (canonicalUrl) {
      const fromCanonical = detectAdapter(canonicalUrl)
      if (fromCanonical) return fromCanonical
    }
  }

  // Direct adapter lookup for types that have no URL pattern (e.g. jsonld).
  // Slug = ats_identifier when set (allows a more specific listing URL),
  // otherwise falls back to the company's careers_url.
  if (atsType) {
    const adapter = getAdapter(atsType as AtsName)
    if (adapter) {
      const slug = atsIdentifier || detectionUrl
      return { adapter, slug }
    }
  }

  return null
}

export type AtsHarvestOutcome =
  | { matched: false }
  | {
      matched: true
      status: "success" | "unchanged" | "failed"
      jobsFound: number
      newJobs: number
      durationMs: number
      errorMessage: string | null
      crawledAtIso: string
      adapter: string
      upstreamLatencyMs: number
      notModified: boolean
    }

// Threshold matches the `min-length` defaults used by the backfill scripts.
// Anything below this isn't a usable description and the adapter should still
// re-attempt a detail fetch.
const ALREADY_DESCRIBED_MIN_LENGTH = 200

async function loadAlreadyDescribedIds(
  pool: Pool,
  companyId: string,
  adapterName: string
): Promise<ReadonlySet<string>> {
  try {
    const { rows } = await pool.query<{ external_id: string }>(
      `SELECT external_id
       FROM jobs
       WHERE company_id = $1
         AND is_active = true
         AND external_id IS NOT NULL
         AND length(description) >= $2
         -- Workday detail HTML used to be flattened into one long line.
         -- Those rows are long, but still need one refresh so headings and
         -- bullets can be preserved for section extraction.
         AND ($3 <> 'workday' OR position(E'\n' in description) > 0)`,
      [companyId, ALREADY_DESCRIBED_MIN_LENGTH, adapterName]
    )
    const out = new Set<string>()
    for (const row of rows) {
      if (row.external_id) out.add(row.external_id)
    }
    return out
  } catch {
    // If the pre-load fails (e.g. transient DB hiccup) we just lose the
    // optimisation for this tick — fall through to the legacy behaviour
    // rather than failing the whole harvest.
    return new Set()
  }
}

async function updateCompanyHarvestState(
  pool: Pool,
  companyId: string,
  args: {
    etag: string | null
    lastModified: string | null
    intervalSec: number
    crawledAtIso: string
    bumpLastCrawled: boolean
    newFreshnessTier?: string | null
    // Yield bookkeeping. "reset" → board produced jobs this crawl; "increment"
    // → empty/304 crawl. Omitted on failures so a broken board's streak isn't
    // conflated with a quiet one (failures have their own cooldown path).
    emptyCrawl?: "reset" | "increment"
  }
) {
  const setTier = args.newFreshnessTier ? ", freshness_tier = $tier" : ""
  const bumpCrawl = args.bumpLastCrawled ? ", last_crawled_at = $crawl::timestamptz" : ""
  const params: unknown[] = [companyId, args.etag, args.lastModified, args.intervalSec]
  let sql = `UPDATE companies
             SET etag = $2,
                 last_modified = $3,
                 next_harvest_at = now() + ($4 || ' seconds')::interval`
  if (args.bumpLastCrawled) {
    params.push(args.crawledAtIso)
    sql += bumpCrawl.replace("$crawl", `$${params.length}`)
  }
  if (args.newFreshnessTier) {
    params.push(args.newFreshnessTier)
    sql += setTier.replace("$tier", `$${params.length}`)
  }
  if (args.emptyCrawl === "reset") {
    sql += `, consecutive_empty_crawls = 0, last_job_seen_at = now()`
  } else if (args.emptyCrawl === "increment") {
    sql += `, consecutive_empty_crawls = consecutive_empty_crawls + 1`
  }
  sql += ` WHERE id = $1`
  await pool.query(sql, params)
}

/** Demote one notch in the freshness tier chain. tier_dead is terminal. */
function demoteFreshnessTier(tier: string | null): string {
  switch (tier) {
    case "tier_1":    return "tier_2"
    case "tier_2":    return "tier_3"
    case "tier_3":    return "tier_dead"
    case "tier_dead": return "tier_dead"
    default:          return "tier_2"
  }
}

/** Count how many of the most recent N harvest attempts failed. */
async function recentFailureCount(
  pool: Pool,
  companyId: string,
  windowCount = 3
): Promise<number> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM crawl_logs
      WHERE company_id = $1
      ORDER BY crawled_at DESC
      LIMIT $2`,
    [companyId, windowCount]
  )
  return rows.filter((r) => r.status === "failed").length
}

/**
 * tier_dead already IS the maximally-backed-off state — its base interval
 * (23h, see TIER_INTERVAL_DEFAULTS) was deliberately shortened to guarantee a
 * daily check-in even for likely-dead boards. Running it back through
 * yieldAdjustedInterval double-counts the exact same consecutive_empty_crawls
 * signal that got the board demoted into tier_dead in the first place — since
 * virtually every tier_dead board has 20+ empty crawls, the 8x multiplier
 * silently stretched it back out to ~7.7 days, undoing the fix entirely. Skip
 * the multiplier once a board is already at the terminal tier.
 */
export function resolveHarvestIntervalSec(
  tier: string | null,
  consecutiveEmptyCrawls: number,
  env: Record<string, string | undefined> = process.env
): number {
  const baseIntervalSec = tierIntervalSeconds(tier, env)
  const intervalSec = tier === "tier_dead"
    ? baseIntervalSec
    : yieldAdjustedInterval(baseIntervalSec, consecutiveEmptyCrawls)
  return Math.min(intervalSec, maxVisitIntervalSeconds(env))
}

export async function runAtsHarvest(input: {
  pool: Pool
  company: AtsHarvestCompany
  signal?: AbortSignal
}): Promise<AtsHarvestOutcome> {
  const { pool, company, signal } = input
  const detection = detectCompanyAdapter(company)
  if (!detection) return { matched: false }

  const startedAt = Date.now()
  const intervalSec = resolveHarvestIntervalSec(company.freshness_tier, company.consecutive_empty_crawls ?? 0)
  const adapterName = detection.adapter.name

  try {
    throwIfAborted(signal)
    // Pre-load externalIds of jobs that already have a real description in the
    // DB. Adapters with per-cycle detail-fetch caps use this to skip jobs that
    // don't need re-fetching, so the cap budget goes to jobs that still need a
    // description. Adapters without a detail-fetch step ignore the field.
    const alreadyDescribedIds = await loadAlreadyDescribedIds(pool, company.id, adapterName)
    throwIfAborted(signal)

    const result = await detection.adapter.fetchJobs({
      slug: detection.slug,
      ctx: {
        etag: company.etag,
        lastModified: company.last_modified,
        alreadyDescribedIds,
        timeoutMs: adapterRequestTimeoutMs(adapterName as AtsName),
        signal,
      },
    })
    throwIfAborted(signal)
    const crawledAtIso = result.fetchedAt.toISOString()

    if (result.notModified) {
      await updateCompanyHarvestState(pool, company.id, {
        etag: result.etag,
        lastModified: result.lastModified,
        intervalSec,
        crawledAtIso,
        bumpLastCrawled: true,
        emptyCrawl: "increment",
      })
      return {
        matched: true,
        status: "unchanged",
        jobsFound: 0,
        newJobs: 0,
        durationMs: Date.now() - startedAt,
        errorMessage: null,
        crawledAtIso,
        adapter: adapterName,
        upstreamLatencyMs: result.upstreamLatencyMs,
        notModified: true,
      }
    }

    const persistResult = await persistJobsBulk({
      pool,
      companyId: company.id,
      companyMeta: {
        name: company.name,
        domain: company.domain,
        careersUrl: company.careers_url,
      },
      sourceAts: adapterName,
      sourceAtsSlug: detection.slug,
      crawledAt: result.fetchedAt,
      jobs: result.jobs,
    })

    await updateCompanyHarvestState(pool, company.id, {
      etag: result.etag,
      lastModified: result.lastModified,
      intervalSec,
      crawledAtIso,
      bumpLastCrawled: false,
      emptyCrawl: result.jobs.length > 0 ? "reset" : "increment",
    })

    // Fire instant alerts the moment a matching job lands. Non-blocking +
    // best-effort; the /api/cron/instant-notify sweep backstops any miss.
    if (persistResult.insertedJobIds.length > 0) {
      void triggerInstantNotify(persistResult.insertedJobIds)
    }

    return {
      matched: true,
      status: result.jobs.length > 0 ? "success" : "unchanged",
      jobsFound: result.jobs.length,
      newJobs: persistResult.inserted,
      durationMs: Date.now() - startedAt,
      errorMessage: null,
      crawledAtIso,
      adapter: adapterName,
      upstreamLatencyMs: result.upstreamLatencyMs,
      notModified: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const crawledAtIso = new Date().toISOString()
    const baseCooldownSec = failureCooldownSeconds()
    const cooldownSec = Math.max(
      intervalSec,
      isHttp404Error(message) || isHttp422Error(message)
        ? Math.max(baseCooldownSec, http404CooldownSeconds())
        : isHttp403Error(message)
        ? Math.max(baseCooldownSec, http403CooldownSeconds())
        : isRateLimitError(message)
        ? rateLimitCooldownSeconds()
        : baseCooldownSec
    )
    const boundedCooldownSec = Math.min(cooldownSec, maxVisitIntervalSeconds())
    // After 3+ consecutive failures (this attempt counts as the 3rd) demote
    // the company one freshness tier. Stops always-broken tenants from
    // burning tier_1 polling cycles forever. Healthy crawls reset the
    // window naturally since we count by status, and the maintenance.ts
    // job re-promotes anything that starts producing jobs again.
    let newTier: string | null = null
    try {
      const recentFails = isRateLimitError(message)
        ? 0
        : await recentFailureCount(pool, company.id, 2)
      if (recentFails >= 2) {
        newTier = demoteFreshnessTier(company.freshness_tier)
        if (newTier === company.freshness_tier) newTier = null
      }
    } catch {
      // Demote-on-failure is best-effort; never let it mask the real error.
    }
    try {
      await updateCompanyHarvestState(pool, company.id, {
        etag: company.etag,
        lastModified: company.last_modified,
        intervalSec: boundedCooldownSec,
        crawledAtIso,
        bumpLastCrawled: false,
        newFreshnessTier: newTier,
      })
    } catch {
      // Secondary DB failures should not mask the original adapter error.
    }
    return {
      matched: true,
      status: "failed",
      jobsFound: 0,
      newJobs: 0,
      durationMs: Date.now() - startedAt,
      errorMessage: message.slice(0, 800),
      crawledAtIso,
      adapter: adapterName,
      upstreamLatencyMs: 0,
      notModified: false,
    }
  }
}

export function harvesterFlagEnabled(): boolean {
  return (
    process.env.HARVESTER_USE_NEW_ADAPTERS === "true" ||
    process.env.HARVESTER_USE_NEW_GREENHOUSE === "true"
  )
}
