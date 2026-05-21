/**
 * Re-test companies marked is_active=false with a crawl_blocked_at timestamp.
 * Uses Playwright + real Chrome (--channel=chrome) so anti-bot guards like
 * Cloudflare / Incapsula / generic 403 don't trigger.
 *
 * For each candidate:
 *   1. Navigate to the careers_url with a real Chrome session
 *   2. Re-run the same block detector the crawler uses
 *   3. If the page is no longer flagged as blocked, clear the block markers
 *      and reactivate the company so the next harvest cycle picks it up
 *
 * Usage:
 *   npx tsx scripts/recover-blocked-companies.ts                # dry-run, all
 *   npx tsx scripts/recover-blocked-companies.ts --execute      # apply changes
 *   npx tsx scripts/recover-blocked-companies.ts --has-jobs-only --limit=60
 *   npx tsx scripts/recover-blocked-companies.ts --reason=blocked_403
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { detectBlockedHtml } from "@/lib/crawler/http"
import { getPostgresPool } from "@/lib/postgres/server"
import type { BrowserContext } from "playwright"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = args.find((v) => v.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1) return args[idx + 1]
  return undefined
}

function intFlag(name: string, fallback: number, min = 1): number {
  const raw = Number.parseInt(flag(name) ?? "", 10)
  return Number.isFinite(raw) && raw >= min ? raw : fallback
}

const execute = args.includes("--execute")
const hasJobsOnly = args.includes("--has-jobs-only")
const verifyRecovered = args.includes("--verify-recovered")
const limit = intFlag("limit", 100)
const concurrency = intFlag("concurrency", 2)
const reasonFilter = flag("reason")?.trim() || null
const navTimeoutMs = intFlag("nav-timeout-ms", 25_000)

// Hosts that are the ATS provider's *marketing* site. Landing on these after
// following redirects means the careers slug is dead / not a real account.
const ATS_MARKETING_HOSTS = new Set([
  "www.bamboohr.com",
  "bamboohr.com",
  "www.greenhouse.io",
  "greenhouse.io",
  "www.lever.co",
  "lever.co",
  "www.ashbyhq.com",
  "ashbyhq.com",
  "www.workday.com",
  "workday.com",
  "www.smartrecruiters.com",
  "smartrecruiters.com",
  "www.workable.com",
  "workable.com",
  "www.recruitee.com",
  "recruitee.com",
  "www.teamtailor.com",
  "teamtailor.com",
  "www.jobvite.com",
  "jobvite.com",
  "www.icims.com",
  "icims.com",
])

const JOB_LISTING_SIGNALS = [
  "apply now",
  "view job",
  "job description",
  "open positions",
  "current openings",
  "full-time",
  "part-time",
  "remote",
  "onsite",
  "hybrid",
  "no openings",
  "no current openings",
  "we don't have any open positions",
]

function looksLikeCareersPage(finalUrl: string, html: string, atsType: string | null): { ok: boolean; reason: string } {
  let host = ""
  try { host = new URL(finalUrl).hostname.toLowerCase() } catch { /* ignore */ }
  if (ATS_MARKETING_HOSTS.has(host)) return { ok: false, reason: `redirected_to_${host}` }

  const lowered = html.toLowerCase()
  // Bamboo-specific: dead slugs show "this organization isn't accepting" or similar
  if (atsType === "bamboohr" && /not\s+accepting\s+applications|no\s+longer\s+accepting/i.test(html)) {
    return { ok: false, reason: "bamboohr_not_accepting" }
  }

  // Generic: must have at least one job-listing signal phrase. "No openings"
  // counts as valid because it's still a real careers page that may have jobs
  // later — the harvester can keep checking.
  const hits = JOB_LISTING_SIGNALS.filter((sig) => lowered.includes(sig)).length
  if (hits === 0) return { ok: false, reason: "no_job_signals" }

  return { ok: true, reason: "looks_like_careers" }
}

const reportPath = path.join(
  process.cwd(),
  "scripts",
  "output",
  `recover-blocked-companies-${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.json`
)

type Candidate = {
  id: string
  name: string
  domain: string | null
  careers_url: string
  ats_type: string | null
  job_count: number
  crawl_blocked_reason: string | null
  crawl_blocked_at: string | null
}

type Outcome = {
  id: string
  name: string
  domain: string | null
  careers_url: string
  job_count: number
  prior_reason: string | null
  status: "recovered" | "still_blocked" | "fetch_error" | "skipped"
  new_reason: string | null
  http_status: number | null
}

async function fetchAndClassify(
  context: BrowserContext,
  url: string
): Promise<{ status: number | null; html: string | null; finalUrl: string | null; error: string | null }> {
  const page = await context.newPage()
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: navTimeoutMs })
    try { await page.waitForLoadState("networkidle", { timeout: 4_000 }) } catch {}
    await page.waitForTimeout(1_000)
    const html = await page.content()
    return { status: response?.status() ?? null, html, finalUrl: page.url(), error: null }
  } catch (error) {
    return { status: null, html: null, finalUrl: null, error: error instanceof Error ? error.message : String(error) }
  } finally {
    try { await page.close() } catch {}
  }
}

async function main() {
  const pool = getPostgresPool()
  const outcomes: Outcome[] = []

  const reasonClause = reasonFilter ? `AND raw_ats_config->>'crawl_blocked_reason' = $1` : ""
  const jobsClause = hasJobsOnly ? `AND job_count > 0` : ""
  const params: unknown[] = reasonFilter ? [reasonFilter] : []
  const limitClause = `LIMIT ${limit}`

  // Verify-recovered mode: re-test companies that were previously reactivated
  // by this script and roll back the ones that don't actually have careers
  // pages (e.g. dead BambooHR slugs that redirect to the marketing site).
  const sql = verifyRecovered
    ? `
    SELECT id::text AS id,
           name,
           domain,
           careers_url,
           ats_type,
           COALESCE(job_count, 0) AS job_count,
           raw_ats_config->>'crawl_blocked_reason' AS crawl_blocked_reason,
           raw_ats_config->>'crawl_blocked_at' AS crawl_blocked_at
      FROM companies
     WHERE raw_ats_config->>'recovery_source' = 'playwright_real_chrome'
       AND is_active = true
       AND careers_url IS NOT NULL AND careers_url <> ''
     ORDER BY ats_type, name
     ${limitClause}
  `
    : `
    SELECT id::text AS id,
           name,
           domain,
           careers_url,
           ats_type,
           COALESCE(job_count, 0) AS job_count,
           raw_ats_config->>'crawl_blocked_reason' AS crawl_blocked_reason,
           raw_ats_config->>'crawl_blocked_at' AS crawl_blocked_at
      FROM companies
     WHERE is_active = false
       AND careers_url IS NOT NULL AND careers_url <> ''
       AND raw_ats_config->>'crawl_blocked_at' IS NOT NULL
       ${reasonClause}
       ${jobsClause}
     ORDER BY job_count DESC NULLS LAST
     ${limitClause}
  `
  const result = await pool.query<Candidate>(sql, params)
  const candidates = result.rows
  console.log(
    [
      "",
      "── Recover blocked companies ────────────────────────────",
      `  mode:          ${execute ? "EXECUTE" : "DRY RUN"}${verifyRecovered ? " (verify-recovered)" : ""}`,
      `  limit:         ${limit}`,
      `  concurrency:   ${concurrency}`,
      `  reason filter: ${reasonFilter ?? "(any)"}`,
      `  has-jobs-only: ${hasJobsOnly}`,
      `  candidates:    ${candidates.length}`,
      "─────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  )

  if (candidates.length === 0) {
    await pool.end()
    return
  }

  const { chromium } = await import("playwright")
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  })
  const context = await browser.newContext({
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined })
  })
  await context.route("**/*", (route) => {
    const type = route.request().resourceType()
    if (type === "image" || type === "font" || type === "media") return route.abort()
    return route.continue()
  })

  const limiter = pLimit(concurrency)

  try {
    await Promise.all(
      candidates.map((c) =>
        limiter(async () => {
          const { status, html, finalUrl, error } = await fetchAndClassify(context, c.careers_url)

          if (error || !html) {
            outcomes.push({
              id: c.id,
              name: c.name,
              domain: c.domain,
              careers_url: c.careers_url,
              job_count: c.job_count,
              prior_reason: c.crawl_blocked_reason,
              status: "fetch_error",
              new_reason: error ?? "no_html",
              http_status: status,
            })
            console.log(`  [error] ${(c.ats_type ?? "?").padEnd(14)} ${c.name.padEnd(34)} -> ${error ?? "no_html"}`)
            return
          }

          const stillBlockedHtml = detectBlockedHtml(html)
          const stillBlocked =
            status === 403 ||
            status === 429 ||
            (status !== null && status >= 500) ||
            Boolean(stillBlockedHtml)

          const verdict = stillBlocked
            ? { ok: false, reason: stillBlockedHtml ?? `http_${status}` }
            : looksLikeCareersPage(finalUrl ?? c.careers_url, html, c.ats_type)

          if (!verdict.ok) {
            outcomes.push({
              id: c.id,
              name: c.name,
              domain: c.domain,
              careers_url: c.careers_url,
              job_count: c.job_count,
              prior_reason: c.crawl_blocked_reason,
              status: "still_blocked",
              new_reason: verdict.reason,
              http_status: status,
            })
            console.log(`  [bad] ${(c.ats_type ?? "?").padEnd(14)} ${c.name.padEnd(30)} -> ${verdict.reason} (final=${finalUrl ?? "?"})`)
            return
          }

          outcomes.push({
            id: c.id,
            name: c.name,
            domain: c.domain,
            careers_url: c.careers_url,
            job_count: c.job_count,
            prior_reason: c.crawl_blocked_reason,
            status: "recovered",
            new_reason: null,
            http_status: status,
          })
          console.log(`  [ok]  ${(c.ats_type ?? "?").padEnd(14)} ${c.name.padEnd(30)} -> ${verdict.reason}`)
        })
      )
    )

    const recovered = outcomes.filter((o) => o.status === "recovered")
    const stillBlocked = outcomes.filter((o) => o.status === "still_blocked")
    const errored = outcomes.filter((o) => o.status === "fetch_error")

    console.log(
      `\nResults: recovered=${recovered.length}  still_blocked=${stillBlocked.length}  errored=${errored.length}`
    )

    if (execute && verifyRecovered) {
      // Roll back companies that were previously reactivated but no longer
      // (or never did) look like real careers pages.
      if (stillBlocked.length > 0) {
        console.log(`\nRolling back ${stillBlocked.length} false-positive reactivations …`)
        for (const o of stillBlocked) {
          await pool.query(
            `UPDATE companies
                SET is_active = false,
                    status = 'dead',
                    raw_ats_config = (raw_ats_config - 'recovered_at' - 'recovery_source')
                      || jsonb_build_object(
                        'crawl_blocked_at', to_jsonb(now()::text),
                        'crawl_blocked_reason', to_jsonb($2::text),
                        'recovery_rolled_back_at', to_jsonb(now()::text)
                      )
              WHERE id = $1`,
            [o.id, o.new_reason ?? "recovery_rollback"]
          )
        }
        console.log("done.")
      } else {
        console.log("\nAll previously-recovered companies still look valid. No rollback needed.")
      }
    } else if (execute && recovered.length > 0) {
      console.log(`\nReactivating ${recovered.length} companies …`)
      for (const o of recovered) {
        await pool.query(
          `UPDATE companies
              SET is_active = true,
                  status = 'active',
                  next_harvest_at = now(),
                  raw_ats_config = (raw_ats_config
                    - 'crawl_blocked_at'
                    - 'crawl_blocked_reason') || jsonb_build_object(
                      'recovered_at', to_jsonb(now()::text),
                      'recovery_source', 'playwright_real_chrome'
                    )
            WHERE id = $1`,
          [o.id]
        )
      }
      console.log("done.")
    } else if (!execute) {
      console.log(`\nDry-run — pass --execute to ${verifyRecovered ? "roll back false positives" : "reactivate the recovered companies"}.`)
    }

    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(reportPath, JSON.stringify({ mode: execute ? "execute" : "dry-run", outcomes }, null, 2))
    console.log(`report: ${reportPath}`)
  } finally {
    await context.close()
    await browser.close()
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[recover-blocked-companies] fatal:", error)
  process.exit(1)
})
