import type { Pool } from "pg"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"

export type CrawlLane =
  | "ats_direct_possible"
  | "general"
  | "blocked"
  | "domain_broken"
  | "likely_inactive"

export type CrawlCompanyLike = {
  id: string
  name: string
  careers_url: string | null
  last_crawled_at: string | null
  ats_type: string | null
  ats_identifier?: string | null
  job_count?: number | null
}

export type CrawlSignal = {
  companyId: string
  status: string
  errorMessage: string | null
  crawledAt: string
}

export type CrawlPolicyOptions = {
  includeBlocked: boolean
  includeDomainBroken: boolean
  includeLikelyInactive: boolean
  bypassCooldown: boolean
  failureStreakMin: number
  defaultCooldownDays: number
  blockedCooldownDays: number
  domainBrokenCooldownDays: number
  badUrlCooldownDays: number
}

export type CrawlSkipDecision = {
  companyId: string
  companyName: string
  lane: CrawlLane
  reason: "lane_excluded" | "cooldown_active"
  streak: number
  cooldownUntil: string | null
}

export type CrawlPolicyResult<T extends CrawlCompanyLike> = {
  selected: T[]
  skipped: CrawlSkipDecision[]
  selectedLaneCounts: Record<CrawlLane, number>
  skippedLaneCounts: Record<CrawlLane, number>
}

const ATS_DIRECT_TYPES = new Set([
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "icims",
  "smartrecruiters",
  "bamboohr",
  "jobvite",
])

const FAILURE_STATUS = new Set(["failed", "blocked", "fetch_error", "bad_url"])

const LANE_PRIORITY: Record<CrawlLane, number> = {
  ats_direct_possible: 0,
  general: 1,
  blocked: 2,
  domain_broken: 3,
  likely_inactive: 4,
}

function boolEnv(name: string, defaultValue: boolean) {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  const normalized = raw.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return defaultValue
}

function normalizeReason(errorMessage: string | null | undefined): string {
  const text = String(errorMessage ?? "").trim().toLowerCase()
  if (!text) return "none"
  if (text.includes("could not resolve host") || text.includes("enotfound")) return "dns_unresolved"
  if (text.includes("ssl certificate") || text.includes("ssl_connect")) return "ssl_error"
  if (text.includes("timeout") || text.includes("timed out")) return "timeout"
  if (text.includes("cloudflare") || text.includes("akamai") || text.includes("incapsula")) return "blocked_html"
  if (text.includes("blocked") || text.includes("access denied") || text.includes("forbidden")) return "blocked"
  if (text.includes("429") || text.includes("rate limit") || text.includes("too many requests")) return "rate_limited"
  if (text.includes("404") || text.includes("not_found")) return "not_found"
  return text.slice(0, 80)
}

function isBlockedSignal(status: string, errorMessage: string | null | undefined) {
  if (status === "blocked") return true
  const reason = normalizeReason(errorMessage)
  return reason === "blocked" || reason === "blocked_html" || reason === "rate_limited"
}

function isDomainBrokenSignal(status: string, errorMessage: string | null | undefined) {
  if (status === "bad_url") return true
  if (status !== "fetch_error" && status !== "failed") return false
  const reason = normalizeReason(errorMessage)
  return reason === "dns_unresolved" || reason === "not_found"
}

function isAtsDirectPossible(company: CrawlCompanyLike) {
  const atsType = (company.ats_type ?? "").toLowerCase()
  if (ATS_DIRECT_TYPES.has(atsType)) return true
  if (company.ats_identifier?.trim()) return true
  const careersUrl = company.careers_url?.trim()
  if (!careersUrl) return false
  const detected = detectAtsFromUrl(careersUrl)
  return Boolean(detected && detected.atsType !== "custom")
}

export function classifyCrawlLane(company: CrawlCompanyLike, latest: CrawlSignal | null): CrawlLane {
  if (latest && isBlockedSignal(latest.status, latest.errorMessage)) return "blocked"
  if (latest && isDomainBrokenSignal(latest.status, latest.errorMessage)) return "domain_broken"
  if (isAtsDirectPossible(company)) return "ats_direct_possible"
  if ((company.job_count ?? 0) === 0 && latest?.status === "unchanged") return "likely_inactive"
  return "general"
}

function signalFingerprint(signal: CrawlSignal): string {
  return `${signal.status}|${normalizeReason(signal.errorMessage)}`
}

function failureStreak(signals: CrawlSignal[]): number {
  if (signals.length === 0) return 0
  const first = signals[0]
  if (!FAILURE_STATUS.has(first.status)) return 0
  const firstKey = signalFingerprint(first)
  let streak = 0
  for (const signal of signals) {
    if (!FAILURE_STATUS.has(signal.status)) break
    if (signalFingerprint(signal) !== firstKey) break
    streak += 1
  }
  return streak
}

function cooldownDaysForLane(lane: CrawlLane, latest: CrawlSignal | null, options: CrawlPolicyOptions) {
  if (!latest) return options.defaultCooldownDays
  if (lane === "domain_broken") return options.domainBrokenCooldownDays
  if (lane === "blocked") return options.blockedCooldownDays
  if (latest.status === "bad_url") return options.badUrlCooldownDays
  return options.defaultCooldownDays
}

function addDays(iso: string, days: number): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms + days * 24 * 60 * 60 * 1000).toISOString()
}

function emptyLaneCounts(): Record<CrawlLane, number> {
  return {
    ats_direct_possible: 0,
    general: 0,
    blocked: 0,
    domain_broken: 0,
    likely_inactive: 0,
  }
}

export function defaultCrawlPolicyOptions(overrides?: Partial<CrawlPolicyOptions>): CrawlPolicyOptions {
  return {
    includeBlocked: boolEnv("CRAWLER_INCLUDE_BLOCKED_IN_MAIN", false),
    includeDomainBroken: boolEnv("CRAWLER_INCLUDE_DOMAIN_BROKEN_IN_MAIN", false),
    includeLikelyInactive: boolEnv("CRAWLER_INCLUDE_LIKELY_INACTIVE_IN_MAIN", false),
    bypassCooldown: false,
    failureStreakMin: Math.max(2, Number.parseInt(process.env.CRAWLER_FAILURE_STREAK_MIN ?? "3", 10)),
    defaultCooldownDays: Math.max(1, Number.parseInt(process.env.CRAWLER_FAILURE_COOLDOWN_DAYS ?? "7", 10)),
    blockedCooldownDays: Math.max(1, Number.parseInt(process.env.CRAWLER_BLOCKED_COOLDOWN_DAYS ?? "14", 10)),
    domainBrokenCooldownDays: Math.max(1, Number.parseInt(process.env.CRAWLER_DOMAIN_BROKEN_COOLDOWN_DAYS ?? "30", 10)),
    badUrlCooldownDays: Math.max(1, Number.parseInt(process.env.CRAWLER_BAD_URL_COOLDOWN_DAYS ?? "30", 10)),
    ...overrides,
  }
}

export async function loadRecentCrawlSignals(
  pool: Pool,
  companyIds: string[],
  depth = 6
): Promise<Map<string, CrawlSignal[]>> {
  const byCompany = new Map<string, CrawlSignal[]>()
  if (companyIds.length === 0) return byCompany

  const { rows } = await pool.query<{
    company_id: string
    status: string
    error_message: string | null
    crawled_at: string
    rn: number
  }>(
    `WITH ranked AS (
       SELECT company_id,
              status,
              error_message,
              crawled_at,
              ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY crawled_at DESC NULLS LAST) AS rn
       FROM crawl_logs
       WHERE company_id = ANY($1::uuid[])
     )
     SELECT company_id, status, error_message, crawled_at, rn
     FROM ranked
     WHERE rn <= $2
     ORDER BY company_id, rn`,
    [companyIds, depth]
  )

  for (const row of rows) {
    const list = byCompany.get(row.company_id) ?? []
    list.push({
      companyId: row.company_id,
      status: row.status,
      errorMessage: row.error_message,
      crawledAt: row.crawled_at,
    })
    byCompany.set(row.company_id, list)
  }

  return byCompany
}

export function applyCrawlQueuePolicy<T extends CrawlCompanyLike>(
  companies: T[],
  signalMap: Map<string, CrawlSignal[]>,
  options: CrawlPolicyOptions
): CrawlPolicyResult<T> {
  const selected: Array<{ row: T; lane: CrawlLane }> = []
  const skipped: CrawlSkipDecision[] = []
  const nowMs = Date.now()
  const selectedLaneCounts = emptyLaneCounts()
  const skippedLaneCounts = emptyLaneCounts()

  for (const company of companies) {
    const signals = signalMap.get(company.id) ?? []
    const latest = signals[0] ?? null
    const lane = classifyCrawlLane(company, latest)
    const streak = failureStreak(signals)

    if (
      (lane === "blocked" && !options.includeBlocked) ||
      (lane === "domain_broken" && !options.includeDomainBroken) ||
      (lane === "likely_inactive" && !options.includeLikelyInactive)
    ) {
      skipped.push({
        companyId: company.id,
        companyName: company.name,
        lane,
        reason: "lane_excluded",
        streak,
        cooldownUntil: null,
      })
      skippedLaneCounts[lane] += 1
      continue
    }

    if (!options.bypassCooldown && latest && streak >= options.failureStreakMin) {
      const cooldownDays = cooldownDaysForLane(lane, latest, options)
      const until = addDays(latest.crawledAt, cooldownDays)
      if (until && Date.parse(until) > nowMs) {
        skipped.push({
          companyId: company.id,
          companyName: company.name,
          lane,
          reason: "cooldown_active",
          streak,
          cooldownUntil: until,
        })
        skippedLaneCounts[lane] += 1
        continue
      }
    }

    selected.push({ row: company, lane })
    selectedLaneCounts[lane] += 1
  }

  selected.sort((a, b) => {
    const laneDelta = LANE_PRIORITY[a.lane] - LANE_PRIORITY[b.lane]
    if (laneDelta !== 0) return laneDelta
    const aTs = Date.parse(a.row.last_crawled_at ?? "")
    const bTs = Date.parse(b.row.last_crawled_at ?? "")
    const aSafe = Number.isNaN(aTs) ? 0 : aTs
    const bSafe = Number.isNaN(bTs) ? 0 : bTs
    return aSafe - bSafe
  })

  return {
    selected: selected.map((entry) => entry.row),
    skipped,
    selectedLaneCounts,
    skippedLaneCounts,
  }
}
