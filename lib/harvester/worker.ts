import type { Pool } from "pg"
import pLimit from "p-limit"
import { adapters, detectAdapter, type AtsName } from "@/lib/harvester/adapters"
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
  adapterFilter?: AdapterClaimFilter
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
    adapterFilter: loadAdapterClaimFilter(env),
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
  oraclecloud: 180_000, // large tenants (JPMorgan ~7.1k) paginate 200/page → ~36 pages + detail-fetch budget
  apple: 280_000, // ~100 Playwright-rendered list pages + a detail-fetch budget
  amazon: 150_000, // paginates up to 100 pages of the amazon.jobs API per tick
  walmart: 480_000, // 5 career areas × up to 200 pages (10/page) of the careers GraphQL
  sitemapjsonld: 300_000, // enumerate sitemap + fetch up to ~2.5k job pages (concurrent)
  ibm: 120_000, // ~9 pages (100/page) of the careers Elasticsearch index
  adecco: 300_000, // up to 300 pages (10/page) of the jobs API, newest-first
  kelly: 480_000, // ~260 pages (10/page) of the mykelly FacetWP endpoint
  microsoft: 240_000, // ~146 search pages (10/page) + a detail-fetch budget
  netflix: 120_000, // ~52 list pages (10/page, Eightfold) + a detail-fetch budget
  eightfold: 240_000, // large tenants (HSBC ~1.6k) paginate 10/page → up to 200 pages
  // Measured a live full run against Capgemini (570 US jobs, list pagination
  // + up to 150 detail-page fetches at concurrency 4): ~52s. Default 60s
  // leaves only ~8s of margin for a first-time crawl of a large tenant
  // before ever hitting yield-adjusted backoff — double it for headroom.
  jobs2web: 120_000,
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

const SUPPORTED_ATS_TYPES = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  // workable was pulled from the allowlist after apply.workable.com 429'd under
  // sustained aggregation. Root cause was RATE, not access: probed politely it
  // returns 200 with full job counts. Re-enabled now that the host is capped in
  // HARVESTER_HOST_RATE_LIMITS (apply.workable.com=6) — the proactive gate keeps
  // us under its per-IP threshold so we never earn the 429 in the first place.
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
  // Purpose-built big-firm adapters: registered + page-deep, but were absent from
  // the claim allowlist so eightfold/netflix companies were never picked up by the
  // 15s harvester loop (only the hourly custom crawler, if at all).
  "eightfold",
  "netflix",
  // Amazon (amazon.jobs API) and Microsoft (jobs.careers.microsoft.com) — single-
  // company custom adapters. The claim-eligibility check runs in SQL against
  // ats_type/CLAIM_URL_SQL only; adapter-level detectFromUrl (used once a company
  // is already claimed) never gets a chance to run without these listed here, so
  // both rows sat unreachable by the automated loop — any freshness they had came
  // from someone manually running a one-off crawl script, not the fast loop.
  "amazon",
  "microsoft",
  // Goldman Sachs (higher.gs.com private GraphQL gateway). Same trap: registered
  // adapter, working, but never in the claim allowlist — so the one goldman-sachs
  // row was never picked up by the fast loop either.
  "goldman-sachs",
  // Avature scrapes {slug}.avature.net careers HTML. Same trap as above — it was
  // registered but not in the claim allowlist, so its ~80 tenants were never
  // claimed by the fast loop. ats_type='avature' has no careers_url pattern, so
  // it must be listed here to be picked up.
  "avature",
  // Walmart (careers.walmart.com GraphQL). Single-company custom adapter; listed
  // here so the one walmart row is claimed by the fast loop.
  "walmart",
  // Sitemap-driven JSON-LD (UPS and other Phenom-Canvas / custom sites). Enrolled
  // by ats_type with the sitemap URL — no careers_url pattern — so list it here.
  "sitemapjsonld",
  // Generic single-page JSON-LD (schema.org/JobPosting embedded directly on a
  // company's own careers page — no ATS platform at all). Same trap as every
  // other ats_type-only adapter above: registered, working, but never in the
  // claim allowlist. Found via audit: ~5,100 companies tagged ats_type='jsonld'
  // were completely unreachable by the fast loop — some 7+ days overdue, most
  // sitting on 20+ consecutive empty crawls that were never actually attempted
  // by anything capable of running this adapter.
  "jsonld",
  // IBM (www-api.ibm.com Elasticsearch). Single-company custom adapter.
  "ibm",
  // Adecco (adecco.com jobs API). Single-company custom adapter.
  "adecco",
  // Kelly Services (mykelly.com FacetWP API). Single-company custom adapter.
  "kelly",
  // Radancy / TalentBrew (careers.*/en/search-jobs/results/ XHR). Registered +
  // page-deep but was absent from the claim allowlist, so its only enrolled
  // tenant (L3Harris) was never claimed by the fast loop. Enrolled by ats_type;
  // slug falls back to careers_url (no canonical URL builder for radancy).
  "radancy",
  // Radancy "Jobs2Web" (careers.*/services/jobs/search/ POST JSON API) — a
  // DIFFERENT Radancy product line than "radancy" above (TalentBrew), found
  // investigating why Capgemini's only enrolled record found exactly 2 jobs
  // forever (its careers_url was a marketing landing page, not this API).
  // Enrolled by ats_type; slug falls back to careers_url.
  "jobs2web",
  // Registered + already crawlable, but claimed only opportunistically via
  // careers_url URL-detection — so many enrolled/reactivated tenants sat
  // uncrawled (gem/pinpoint barely appeared in crawl_logs). List them here so
  // the fast loop claims them by ats_type like every other supported adapter.
  "gem",
  "pinpoint",
  "rippling",
  "breezy",
  // TikTok careers.tiktok.com / lifeattiktok.com POST API. Single global tenant;
  // must be listed here because careers.tiktok.com has no URL pattern in CLAIM_URL_SQL.
  "tiktok",
  // Google careers (www.google.com/about/careers/applications results-page scrape).
  // Single global tenant, claimed by ats_type='google' (no careers_url pattern).
  "google",
] as const satisfies readonly AtsName[]

export type AdapterClaimFilter = {
  include: AtsName[] | null
  exclude: AtsName[]
}

const DEFAULT_ADAPTER_CLAIM_FILTER: AdapterClaimFilter = {
  include: null,
  exclude: [],
}

const SUPPORTED_ATS_TYPE_SET = new Set<string>(SUPPORTED_ATS_TYPES)

const CLAIM_URL_SQL: Partial<Record<AtsName, string[]>> = {
  greenhouse: [
    "careers_url ILIKE 'https://boards.greenhouse.io/%'",
    "careers_url ILIKE 'https://job-boards.greenhouse.io/%'",
    "direct_ats_url ILIKE 'https://boards.greenhouse.io/%'",
    "direct_ats_url ILIKE 'https://job-boards.greenhouse.io/%'",
  ],
  lever: [
    "careers_url ILIKE 'https://jobs.lever.co/%'",
    "direct_ats_url ILIKE 'https://jobs.lever.co/%'",
  ],
  ashby: [
    "careers_url ILIKE 'https://jobs.ashbyhq.com/%'",
    "direct_ats_url ILIKE 'https://jobs.ashbyhq.com/%'",
  ],
  smartrecruiters: [
    "careers_url ILIKE 'https://jobs.smartrecruiters.com/%'",
    "careers_url ILIKE 'https://careers.smartrecruiters.com/%'",
    "direct_ats_url ILIKE 'https://jobs.smartrecruiters.com/%'",
    "direct_ats_url ILIKE 'https://careers.smartrecruiters.com/%'",
  ],
  workable: [
    "careers_url ILIKE 'https://apply.workable.com/%'",
    "careers_url ILIKE 'https://jobs.workable.com/%'",
    "direct_ats_url ILIKE 'https://apply.workable.com/%'",
    "direct_ats_url ILIKE 'https://jobs.workable.com/%'",
  ],
  workday: [
    "careers_url ~* '^https?://[a-z0-9-]+\\.wd[0-9]{1,3}\\.myworkdayjobs\\.com/'",
    "direct_ats_url ~* '^https?://[a-z0-9-]+\\.wd[0-9]{1,3}\\.myworkdayjobs\\.com/'",
  ],
  recruitee: [
    "careers_url ~* '^https?://[a-z0-9-]+\\.recruitee\\.com/'",
    "direct_ats_url ~* '^https?://[a-z0-9-]+\\.recruitee\\.com/'",
  ],
  teamtailor: [
    "careers_url ~* '^https?://[a-z0-9-]+\\.teamtailor\\.com/'",
    "direct_ats_url ~* '^https?://[a-z0-9-]+\\.teamtailor\\.com/'",
  ],
  personio: [
    "careers_url ~* '^https?://[a-z0-9-]+\\.jobs\\.personio\\.(com|de)/'",
    "direct_ats_url ~* '^https?://[a-z0-9-]+\\.jobs\\.personio\\.(com|de)/'",
  ],
  bamboohr: [
    "careers_url ~* '^https?://[a-z0-9-]+\\.bamboohr\\.com/'",
    "direct_ats_url ~* '^https?://[a-z0-9-]+\\.bamboohr\\.com/'",
  ],
  jazzhr: [
    "careers_url ~* '^https?://[a-z0-9-]+\\.applytojob\\.com/'",
    "direct_ats_url ~* '^https?://[a-z0-9-]+\\.applytojob\\.com/'",
  ],
  jobvite: [
    "careers_url ILIKE 'https://jobs.jobvite.com/%'",
    "direct_ats_url ILIKE 'https://jobs.jobvite.com/%'",
  ],
  infosys: [
    "careers_url ILIKE 'https://digitalcareers.infosys.com/%'",
    "direct_ats_url ILIKE 'https://digitalcareers.infosys.com/%'",
  ],
  apple: [
    "careers_url ILIKE 'https://jobs.apple.com/%'",
    "direct_ats_url ILIKE 'https://jobs.apple.com/%'",
  ],
}

function parseAdapterList(raw: string | undefined): AtsName[] {
  if (!raw?.trim()) return []
  const parsed: AtsName[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,\s]+/)) {
    const name = part.trim().toLowerCase()
    if (!name || seen.has(name) || !SUPPORTED_ATS_TYPE_SET.has(name)) continue
    seen.add(name)
    parsed.push(name as AtsName)
  }
  return parsed
}

function loadAdapterClaimFilter(
  env: Record<string, string | undefined> = process.env
): AdapterClaimFilter {
  const include = parseAdapterList(env.HARVESTER_INCLUDE_ADAPTERS)
  const exclude = parseAdapterList(env.HARVESTER_EXCLUDE_ADAPTERS)
  return {
    include: include.length > 0 ? include : null,
    exclude,
  }
}

export function enabledClaimAdapters(filter?: AdapterClaimFilter): AtsName[] {
  const normalized = filter ?? DEFAULT_ADAPTER_CLAIM_FILTER
  // An explicit include list is an allow-list and wins outright: a global exclude
  // (e.g. the main lane's HARVESTER_EXCLUDE_ADAPTERS=workable, which the deploy
  // orchestrator injects into every service) must NOT cancel a dedicated worker
  // that explicitly includes that adapter — otherwise it claims nothing.
  if (normalized.include && normalized.include.length > 0) {
    return [...normalized.include]
  }
  const excluded = new Set(normalized.exclude)
  return [...SUPPORTED_ATS_TYPES].filter((name) => !excluded.has(name))
}

// Single-company (or near-single-company) custom adapters. The shared claim
// query orders purely by overdueness, and Workday/OracleCloud's chronic
// backlogs (driven by frequent per-company timeouts — see company_hang logs)
// always have a row more overdue than one of these singletons, so they can
// be starved indefinitely: Apple's oldest next_harvest_at was 20 days stale
// and Goldman Sachs hadn't been reclaimed in 11+ hours despite being due,
// even though both adapters work fine when actually invoked. Every prior fix
// for a "company X is never claimed" bug just added X to SUPPORTED_ATS_TYPES,
// which doesn't help if it still loses the overdueness race forever. Reserve
// a small guaranteed slice of each tick's claim budget for this list instead.
const RESERVED_LOW_CARDINALITY_ADAPTERS: readonly AtsName[] = [
  "goldman-sachs",
  "walmart",
  "amazon",
  "apple",
  "microsoft",
  "netflix",
  "ibm",
  "adecco",
  "kelly",
  "google",
  "infosys",
  "tiktok",
]

function buildClaimQuery(enabledAdapters: readonly AtsName[]): string {
  const adapterClauses = [
    "ats_type = ANY($3::text[])",
    ...enabledAdapters.flatMap((name) => CLAIM_URL_SQL[name] ?? []),
  ]
    .map((clause) => `      ${clause}`)
    .join("\n      OR ")

  return `
UPDATE companies
SET next_harvest_at = now() + ($2 || ' seconds')::interval
WHERE id IN (
  SELECT id FROM companies
  WHERE status = 'active'
    AND is_active = true
    AND duplicate_of_company_id IS NULL
    AND careers_url IS NOT NULL
    AND (
${adapterClauses}
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
}

// tier_dead's interval was shortened from 7 days to 23h (see run-harvest.ts)
// so every board gets at least a daily check-in — but tier_dead is ~37% of
// the whole active company base (20k+ boards), and the shared claim query
// orders purely by overdueness. Without its own reservation, tier_dead's
// sheer volume would compete with — and could crowd out — tier_1/2/3's
// existing claim budget the same way the low-cardinality adapters above
// were starved. These boards are typically fast to crawl (few/no postings
// means pagination exits after page 1), so a small reserved slice per tick
// comfortably cycles through all of them within 24h without taking capacity
// away from higher-value tiers.
function buildTierDeadClaimQuery(enabledAdapters: readonly AtsName[]): string {
  const adapterClauses = [
    "ats_type = ANY($3::text[])",
    ...enabledAdapters.flatMap((name) => CLAIM_URL_SQL[name] ?? []),
  ]
    .map((clause) => `      ${clause}`)
    .join("\n      OR ")

  return `
UPDATE companies
SET next_harvest_at = now() + ($2 || ' seconds')::interval
WHERE id IN (
  SELECT id FROM companies
  WHERE status = 'active'
    AND is_active = true
    AND duplicate_of_company_id IS NULL
    AND careers_url IS NOT NULL
    AND freshness_tier = 'tier_dead'
    AND (
${adapterClauses}
    )
    AND (next_harvest_at IS NULL OR next_harvest_at <= now())
  ORDER BY next_harvest_at ASC NULLS FIRST
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, name, careers_url, direct_ats_url, domain, ats_type, ats_identifier, raw_ats_config, etag, last_modified, freshness_tier, consecutive_empty_crawls
`
}

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

// Reserved slice as a fraction of the tick's claim budget, floored at 1 so a
// single-company adapter always has a shot even on a small batch. Capped at 3
// so it can't crowd out the main pool on a large batch — there are only ever
// a handful of due rows across this whole adapter list at once anyway.
const RESERVED_CLAIM_MIN = 1
const RESERVED_CLAIM_MAX = 3

// tier_dead's reservation is sized off actual volume, not a fixed floor: at
// ~1/tick/worker sustained, 6 workers ticking every 15s already clears
// 34k+/day — comfortably more than the ~20k tier_dead boards that exist today
// — so a small fixed reservation is enough without needing to scale with the
// claim batch size the way the adapter reservation does.
const TIER_DEAD_RESERVED_CLAIM = 2

export async function claimEligibleCompanies(
  pool: Pool,
  batchSize: number,
  leaseSeconds: number,
  adapterFilter?: AdapterClaimFilter
): Promise<AtsHarvestCompany[]> {
  const enabledAdapters = enabledClaimAdapters(adapterFilter)
  if (enabledAdapters.length === 0) return []

  const reservedAdapters = enabledAdapters.filter((name) =>
    RESERVED_LOW_CARDINALITY_ADAPTERS.includes(name)
  )

  let reservedRows: ClaimedRow[] = []
  if (reservedAdapters.length > 0) {
    const reservedLimit = Math.min(
      RESERVED_CLAIM_MAX,
      Math.max(RESERVED_CLAIM_MIN, batchSize - 1)
    )
    const reserved = await pool.query<ClaimedRow>(buildClaimQuery(reservedAdapters), [
      reservedLimit,
      leaseSeconds,
      reservedAdapters,
    ])
    reservedRows = reserved.rows
  }

  const tierDeadLimit = Math.min(TIER_DEAD_RESERVED_CLAIM, Math.max(1, batchSize - reservedRows.length - 1))
  const tierDeadReserved = await pool.query<ClaimedRow>(buildTierDeadClaimQuery(enabledAdapters), [
    tierDeadLimit,
    leaseSeconds,
    enabledAdapters,
  ])
  reservedRows = [...reservedRows, ...tierDeadReserved.rows]

  const remainingBatchSize = Math.max(1, batchSize - reservedRows.length)
  const { rows: mainRows } = await pool.query<ClaimedRow>(buildClaimQuery(enabledAdapters), [
    remainingBatchSize,
    leaseSeconds,
    enabledAdapters,
  ])

  const seen = new Set(reservedRows.map((r) => r.id))
  const rows = [...reservedRows, ...mainRows.filter((r) => !seen.has(r.id))]
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
  const companies = await claimEligibleCompanies(
    pool,
    config.claimBatchSize,
    config.leaseSeconds,
    config.adapterFilter
  )

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
      claimAdapters: enabledClaimAdapters(config.adapterFilter),
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
