/**
 * Audit active tech companies for crawl compliance signals and disable crawling
 * when we detect robots/firewall blockers.
 *
 * "Disable crawling" here means:
 * - set `raw_ats_config.crawl_allowed = false`
 * - persist reason metadata in `raw_ats_config`
 *
 * Crawler selection routes are expected to honor this flag.
 *
 * Usage:
 *   npx tsx scripts/audit-tech-crawl-compliance.ts
 *   npx tsx scripts/audit-tech-crawl-compliance.ts --execute
 *   npx tsx scripts/audit-tech-crawl-compliance.ts --execute --limit=500
 *   npx tsx scripts/audit-tech-crawl-compliance.ts --execute --concurrency=20
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const dryRun = !execute
const limit = Number(flag("limit")) || undefined
const concurrency = Math.max(1, Number(flag("concurrency")) || 18)
const timeoutMs = Math.max(2000, Number(flag("timeout-ms")) || 9000)
const reportPath =
  flag("report") ||
  path.join(
    "scripts",
    "output",
    `tech-crawl-compliance-${new Date().toISOString().slice(0, 10)}.json`
  )

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  industry: string | null
  careers_url: string | null
  direct_ats_url: string | null
  raw_ats_config: Record<string, unknown> | null
}

type CrawlHistoryRow = {
  company_id: string
  blocked_count: number
  waf_like_count: number
  recent_success_job_crawls: number
}

type RobotsCheck = {
  host: string
  fetched: boolean
  statusCode: number | null
  disallowAll: boolean
  disallowPath: boolean
  sourceUrl: string | null
  error: string | null
}

type LiveCheck = {
  url: string | null
  statusCode: number | null
  blockedByStatus: boolean
  blockedByHtml: boolean
  blockedMarker: string | null
  error: string | null
}

type AuditOutcome = {
  company: Pick<CompanyRow, "id" | "name" | "domain" | "industry" | "careers_url" | "direct_ats_url">
  host: string | null
  targetUrl: string | null
  robots: RobotsCheck | null
  live: LiveCheck | null
  history: { blockedCount: number; wafLikeCount: number }
  hasRecentSuccessJobs: boolean
  advisories: string[]
  shouldDisable: boolean
  reasons: string[]
}

const BLOCKED_HTML_RULES: Array<{ re: RegExp; reason: string }> = [
  { re: /attention required.*cloudflare/i, reason: "cloudflare_challenge" },
  { re: /cdn-cgi\/challenge-platform/i, reason: "cloudflare_challenge_platform" },
  { re: /cf-chl-/i, reason: "cloudflare_challenge_token" },
  { re: /checking (?:if|your) browser/i, reason: "browser_challenge" },
  { re: /please enable javascript and cookies/i, reason: "js_cookie_challenge" },
  { re: /why (?:have|do) i (?:been )?blocked/i, reason: "blocked_explainer" },
  { re: /request blocked/i, reason: "request_blocked" },
  { re: /access denied/i, reason: "access_denied" },
  { re: /\b403 forbidden\b/i, reason: "forbidden_403" },
  { re: /verify you are human/i, reason: "human_verification" },
  { re: /security check to access/i, reason: "security_check" },
  { re: /perimeterx|px-captcha|distil/i, reason: "bot_challenge_vendor" },
]

function isPlaceholderDomain(domain: string | null | undefined) {
  const d = (domain ?? "").toLowerCase()
  return d.endsWith(".lca-employer") || d.endsWith(".uscis-employer")
}

function normalizeHost(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  const withProto = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`
  try {
    const url = new URL(withProto)
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

function parseUrl(raw: string | null | undefined): URL | null {
  const value = (raw ?? "").trim()
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    try {
      return new URL(`https://${value}`)
    } catch {
      return null
    }
  }
}

function pickTargetUrl(company: CompanyRow): URL | null {
  const direct = parseUrl(company.direct_ats_url)
  if (direct) return direct
  const careers = parseUrl(company.careers_url)
  if (careers) return careers
  const host = normalizeHost(company.domain ?? "")
  return host ? new URL(`https://${host}`) : null
}

function stripComments(line: string) {
  const i = line.indexOf("#")
  return (i === -1 ? line : line.slice(0, i)).trim()
}

function normalizeRobotsPath(rulePath: string) {
  const value = rulePath.trim()
  if (!value) return ""
  return value.replace(/\*/g, "")
}

function longestMatchingPrefix(pathname: string, rules: string[]) {
  let best = -1
  for (const rawRule of rules) {
    const rule = normalizeRobotsPath(rawRule)
    if (!rule) continue
    if (rule === "/") best = Math.max(best, 1)
    else if (pathname.startsWith(rule)) best = Math.max(best, rule.length)
  }
  return best
}

function analyzeRobots(robotsText: string, targetPath: string): { disallowAll: boolean; disallowPath: boolean } {
  const lines = robotsText.split(/\r?\n/)
  const starDisallow: string[] = []
  const starAllow: string[] = []
  let appliesToStar = false

  for (const rawLine of lines) {
    const line = stripComments(rawLine)
    if (!line) continue
    const sep = line.indexOf(":")
    if (sep === -1) continue
    const key = line.slice(0, sep).trim().toLowerCase()
    const value = line.slice(sep + 1).trim()

    if (key === "user-agent") {
      appliesToStar = value === "*"
      continue
    }

    if (!appliesToStar) continue

    if (key === "disallow") {
      starDisallow.push(value)
      continue
    }
    if (key === "allow") {
      starAllow.push(value)
      continue
    }
  }

  const disallowAll = starDisallow.some((d) => d.trim() === "/")
  const disallowLen = longestMatchingPrefix(targetPath, starDisallow)
  const allowLen = longestMatchingPrefix(targetPath, starAllow)
  const disallowPath = disallowLen > 0 && disallowLen >= allowLen

  return { disallowAll, disallowPath }
}

async function fetchText(url: string, timeout: number): Promise<{ statusCode: number | null; text: string | null; error: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html, text/plain, application/xhtml+xml;q=0.9,*/*;q=0.8",
      },
    })
    const text = await response.text()
    return { statusCode: response.status, text, error: null }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { statusCode: null, text: null, error: msg.slice(0, 300) }
  } finally {
    clearTimeout(timer)
  }
}

function detectBlockedMarker(html: string | null): string | null {
  if (!html) return null
  const hit = BLOCKED_HTML_RULES.find((entry) => entry.re.test(html))
  return hit?.reason ?? null
}

function isBlockedStatus(statusCode: number | null): boolean {
  if (statusCode === null) return false
  return statusCode === 401 || statusCode === 403 || statusCode === 406 || statusCode === 429
}

function isHardHtmlBlock(marker: string | null, statusCode: number | null): boolean {
  if (!marker) return false
  const hardAlways = new Set([
    "cloudflare_challenge",
    "browser_challenge",
    "js_cookie_challenge",
    "blocked_explainer",
    "request_blocked",
    "access_denied",
    "forbidden_403",
    "human_verification",
    "security_check",
  ])
  if (hardAlways.has(marker)) return true

  const needsBlockedStatus = new Set([
    "cloudflare_challenge_platform",
    "cloudflare_challenge_token",
    "bot_challenge_vendor",
  ])
  return needsBlockedStatus.has(marker) && isBlockedStatus(statusCode)
}

async function checkRobotsForHost(host: string, targetPath: string): Promise<RobotsCheck> {
  const urls = [`https://${host}/robots.txt`, `http://${host}/robots.txt`]
  for (const robotsUrl of urls) {
    const fetched = await fetchText(robotsUrl, timeoutMs)
    if (fetched.statusCode === null) continue
    if (fetched.statusCode >= 400) {
      return {
        host,
        fetched: true,
        statusCode: fetched.statusCode,
        disallowAll: false,
        disallowPath: false,
        sourceUrl: robotsUrl,
        error: null,
      }
    }
    const analysis = analyzeRobots(fetched.text ?? "", targetPath || "/")
    return {
      host,
      fetched: true,
      statusCode: fetched.statusCode,
      disallowAll: analysis.disallowAll,
      disallowPath: analysis.disallowPath,
      sourceUrl: robotsUrl,
      error: null,
    }
  }
  return {
    host,
    fetched: false,
    statusCode: null,
    disallowAll: false,
    disallowPath: false,
    sourceUrl: null,
    error: "robots_unreachable",
  }
}

function techFilterSql() {
  return `c.is_active = true
    AND (
      c.industry ILIKE '%tech%'
      OR c.industry ILIKE '%software%'
      OR c.industry ILIKE '%internet%'
      OR c.industry ILIKE '%artificial intelligence%'
      OR c.industry ILIKE '%cyber%'
      OR c.industry ILIKE '%cloud%'
      OR c.industry ILIKE '%data%'
    )`
}

async function loadTechCompanies(pool: Pool): Promise<CompanyRow[]> {
  const { rows } = await pool.query<CompanyRow>(
    `SELECT c.id, c.name, c.domain, c.industry, c.careers_url, c.direct_ats_url, c.raw_ats_config
       FROM companies c
      WHERE ${techFilterSql()}
        AND COALESCE((c.raw_ats_config->>'crawl_allowed')::boolean, true) = true
      ORDER BY c.last_crawled_at NULLS FIRST, c.updated_at DESC`
  )
  return rows
}

async function loadCrawlHistoryMap(pool: Pool, companyIds: string[]): Promise<Map<string, CrawlHistoryRow>> {
  if (companyIds.length === 0) return new Map()
  const { rows } = await pool.query<CrawlHistoryRow>(
    `SELECT cl.company_id,
            COUNT(*) FILTER (WHERE cl.status = 'blocked')::int AS blocked_count,
            COUNT(*) FILTER (
              WHERE COALESCE(cl.error_message, '') ILIKE ANY(
                ARRAY[
                  '%cloudflare%',
                  '%akamai%',
                  '%incapsula%',
                  '%perimeterx%',
                  '%access denied%',
                  '%forbidden%',
                  '%captcha%',
                  '%rate limit%',
                  '%too many requests%'
                ]::text[]
              )
            )::int AS waf_like_count,
            COUNT(*) FILTER (
              WHERE cl.status = 'success'
                AND COALESCE(cl.jobs_found, 0) > 0
                AND cl.crawled_at >= NOW() - INTERVAL '30 days'
            )::int AS recent_success_job_crawls
       FROM crawl_logs cl
      WHERE cl.company_id = ANY($1::uuid[])
        AND cl.crawled_at >= NOW() - INTERVAL '180 days'
      GROUP BY cl.company_id`,
    [companyIds]
  )
  return new Map(rows.map((row) => [row.company_id, row]))
}

async function runAudit(pool: Pool, companies: CompanyRow[]): Promise<AuditOutcome[]> {
  const historyMap = await loadCrawlHistoryMap(
    pool,
    companies.map((c) => c.id)
  )

  const limiter = pLimit(concurrency)
  const robotsCache = new Map<string, Promise<RobotsCheck>>()

  const work = companies.map((company) =>
    limiter(async (): Promise<AuditOutcome> => {
      const target = pickTargetUrl(company)
      const host = target?.hostname?.toLowerCase() ?? normalizeHost(company.domain ?? "")
      const pathToCheck = target?.pathname || "/"

      const history = historyMap.get(company.id)
      const blockedCount = history?.blocked_count ?? 0
      const wafLikeCount = history?.waf_like_count ?? 0
      const recentSuccessJobs = history?.recent_success_job_crawls ?? 0
      const hasRecentSuccessJobs = recentSuccessJobs > 0

      let robots: RobotsCheck | null = null
      if (host) {
        if (!robotsCache.has(host)) {
          robotsCache.set(host, checkRobotsForHost(host, pathToCheck))
        }
        robots = await robotsCache.get(host)!
      }

      let live: LiveCheck | null = null
      if (target) {
        const fetched = await fetchText(target.toString(), timeoutMs)
        const marker = detectBlockedMarker(fetched.text)
        live = {
          url: target.toString(),
          statusCode: fetched.statusCode,
          blockedByStatus: isBlockedStatus(fetched.statusCode),
          blockedByHtml: isHardHtmlBlock(marker, fetched.statusCode),
          blockedMarker: marker,
          error: fetched.error,
        }
      }

      const reasons: string[] = []
      const advisories: string[] = []
      if (robots?.disallowAll) advisories.push("robots_disallow_all")
      if (robots?.disallowPath) advisories.push("robots_disallow_target_path")
      if (!hasRecentSuccessJobs) {
        if (live?.blockedByStatus) reasons.push(`live_status_${live.statusCode}`)
        if (live?.blockedByHtml && live.blockedMarker) reasons.push(`live_html_${live.blockedMarker}`)
        if (blockedCount + wafLikeCount >= 2) reasons.push("historical_repeat_waf_or_blocked")
      }

      const shouldDisable = reasons.length > 0

      return {
        company: {
          id: company.id,
          name: company.name,
          domain: company.domain,
          industry: company.industry,
          careers_url: company.careers_url,
          direct_ats_url: company.direct_ats_url,
        },
        host,
        targetUrl: target?.toString() ?? null,
        robots,
        live,
        history: {
          blockedCount,
          wafLikeCount,
        },
        hasRecentSuccessJobs,
        advisories,
        shouldDisable,
        reasons,
      }
    })
  )

  return Promise.all(work)
}

async function applyDecisions(pool: Pool, flagged: AuditOutcome[]) {
  if (flagged.length === 0) return

  for (const row of flagged) {
    const raw = {
      crawl_allowed: false,
      crawl_policy_source: "tech_compliance_audit",
      crawl_blocked_at: new Date().toISOString(),
      crawl_block_reason: row.reasons.join(","),
      crawl_block_detail: {
        host: row.host,
        targetUrl: row.targetUrl,
        robots: row.robots,
        live: row.live
          ? {
              statusCode: row.live.statusCode,
              blockedByStatus: row.live.blockedByStatus,
              blockedByHtml: row.live.blockedByHtml,
              blockedMarker: row.live.blockedMarker,
              error: row.live.error,
            }
          : null,
        history: row.history,
      },
    }

    await pool.query(
      `UPDATE companies
          SET raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb) || $1::jsonb,
              updated_at = NOW()
        WHERE id = $2::uuid`,
      [JSON.stringify(raw), row.company.id]
    )
  }
}

function writeReport(payload: unknown) {
  const abs = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(process.cwd(), reportPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2))
  return abs
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (or TARGET_POSTGRES_URL)")
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const loaded = await loadTechCompanies(pool)
    const companies = limit ? loaded.slice(0, limit) : loaded

    console.log(
      `[tech-crawl-compliance] mode=${execute ? "EXECUTE" : "DRY-RUN"} companies=${companies.length} concurrency=${concurrency}`
    )

    const outcomes = await runAudit(pool, companies)
    const flagged = outcomes.filter((row) => row.shouldDisable)

    if (!dryRun) {
      await applyDecisions(pool, flagged)
    }

    const summary = {
      mode: execute ? "EXECUTE" : "DRY-RUN",
      checkedCompanies: companies.length,
      flaggedCompanies: flagged.length,
      reasonCounts: flagged.reduce<Record<string, number>>((acc, row) => {
        for (const reason of row.reasons) {
          acc[reason] = (acc[reason] ?? 0) + 1
        }
        return acc
      }, {}),
      sampleFlagged: flagged.slice(0, 30).map((row) => ({
        id: row.company.id,
        name: row.company.name,
        domain: row.company.domain,
        reasons: row.reasons,
        statusCode: row.live?.statusCode ?? null,
      })),
    }

    const reportFile = writeReport({
      generatedAt: new Date().toISOString(),
      summary,
      flagged,
    })

    console.log("[tech-crawl-compliance] Summary")
    console.log(`  Checked: ${summary.checkedCompanies}`)
    console.log(`  Flagged: ${summary.flaggedCompanies}`)
    console.log(`  Report: ${reportFile}`)
    console.log(`  Reasons: ${JSON.stringify(summary.reasonCounts)}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[tech-crawl-compliance] failed", error)
  process.exit(1)
})
