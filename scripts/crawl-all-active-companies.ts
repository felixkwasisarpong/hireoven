/**
 * Full-system crawl for all active, crawl-allowed companies with careers URLs.
 * Non-destructive: does not deactivate companies on crawl failure.
 *
 * Usage:
 *   npx tsx scripts/crawl-all-active-companies.ts
 *   npx tsx scripts/crawl-all-active-companies.ts --execute
 *   npx tsx scripts/crawl-all-active-companies.ts --execute --concurrency=6
 *   npx tsx scripts/crawl-all-active-companies.ts --execute --limit=500
 *   npx tsx scripts/crawl-all-active-companies.ts --execute --playwright-blocked-pass
 *   npx tsx scripts/crawl-all-active-companies.ts --execute --no-playwright-blocked-pass
 *   npx tsx scripts/crawl-all-active-companies.ts --execute --playwright-blocked-concurrency=4
 *   npx tsx scripts/crawl-all-active-companies.ts --execute --playwright-blocked-limit=200
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

function sanitizeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500)
  return String(error).slice(0, 500)
}

function boolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return defaultValue
  const normalized = raw.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return defaultValue
}

function parseHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isBlockedLikeResult(row: CrawlResultRow): boolean {
  const outcomeStatus = (row.outcome_status ?? "").toLowerCase()
  const reason = (row.outcome_reason ?? row.error ?? "").toLowerCase()
  if (outcomeStatus === "blocked") return true
  if (!reason) return false
  return (
    reason.includes("blocked") ||
    reason.includes("403") ||
    reason.includes("forbidden") ||
    reason.includes("cloudflare") ||
    reason.includes("akamai") ||
    reason.includes("not_acceptable")
  )
}

const execute = process.argv.includes("--execute")
const limit = Math.max(0, Number(flag("limit")) || 0) || undefined
const concurrency = Math.max(
  1,
  Number(flag("concurrency")) || Number(process.env.CRAWLER_COMPANY_CONCURRENCY) || 4
)
const onlyNotRecentMinutes = Math.max(0, Number(flag("only-not-recent-minutes")) || 0) || undefined
const enablePlaywrightBlockedPass =
  !process.argv.includes("--no-playwright-blocked-pass") &&
  (process.argv.includes("--playwright-blocked-pass") ||
    boolEnv("CRAWLER_ENABLE_PLAYWRIGHT_BLOCKED_PASS", true))
const playwrightBlockedConcurrency = Math.max(
  1,
  Number(flag("playwright-blocked-concurrency")) ||
    Number(process.env.CRAWLER_PLAYWRIGHT_BLOCKED_CONCURRENCY) ||
    Math.min(concurrency, 4)
)
const playwrightBlockedLimit =
  Math.max(
    0,
    Number(flag("playwright-blocked-limit")) ||
      Number(process.env.CRAWLER_PLAYWRIGHT_BLOCKED_LIMIT) ||
      0
  ) || undefined
const reportPath =
  flag("report") ||
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `full-system-crawl-report-${new Date().toISOString().slice(0, 10)}.json`
  )

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string
  ats_type: string | null
  ats_identifier: string | null
  last_crawled_at: string | null
  job_count: number | null
}

type CrawlResultRow = {
  crawl_pass: "primary" | "playwright_blocked"
  company_id: string
  company_name: string
  domain: string | null
  careers_url: string
  ats_type: string | null
  status: "ok" | "error"
  found_jobs: number
  inserted: number
  updated: number
  active_count: number
  outcome_status: string | null
  outcome_reason: string | null
  error: string | null
  duration_ms: number
}

let uncaughtExceptionCount = 0
let unhandledRejectionCount = 0

process.on("uncaughtException", (error) => {
  uncaughtExceptionCount += 1
  console.error(`[full-crawl] uncaughtException: ${sanitizeError(error)}`)
})

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes("Controller is already closed")) return
  unhandledRejectionCount += 1
  console.error(`[full-crawl] unhandledRejection: ${sanitizeError(reason)}`)
})

function writeReport(payload: unknown): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  console.log(`[full-crawl] report: ${reportPath}`)
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    throw new Error("Missing DATABASE_URL (or TARGET_POSTGRES_URL) in environment")
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const staleWhere = onlyNotRecentMinutes
      ? `AND (last_crawled_at IS NULL OR last_crawled_at < NOW() - INTERVAL '${onlyNotRecentMinutes} minutes')`
      : ""
    const limitSql = limit ? `LIMIT ${limit}` : ""
    const { rows: allTargets } = await pool.query<CompanyRow>(
      `SELECT
         id,
         name,
         domain,
         careers_url,
         ats_type,
         ats_identifier,
         last_crawled_at,
         job_count
       FROM companies
       WHERE is_active = true
         AND COALESCE((raw_ats_config->>'crawl_allowed')::boolean, true) = true
         AND careers_url IS NOT NULL
         AND btrim(careers_url) <> ''
         ${staleWhere}
       ORDER BY last_crawled_at NULLS FIRST, updated_at DESC
       ${limitSql}`
    )

    console.log(
      `[full-crawl] mode=${execute ? "EXECUTE" : "dry-run"} total_targets=${allTargets.length} concurrency=${concurrency}${limit ? ` limit=${limit}` : ""}${onlyNotRecentMinutes ? ` onlyNotRecentMinutes=${onlyNotRecentMinutes}` : ""} playwrightBlockedPass=${enablePlaywrightBlockedPass}`
    )

    if (!execute) {
      for (const row of allTargets.slice(0, 100)) {
        console.log(
          `  ${(row.domain ?? "(no-domain)").padEnd(32)} ${(row.name ?? "").slice(0, 36).padEnd(36)} ats=${(row.ats_type ?? "null").padEnd(12)} jobs=${String(row.job_count ?? 0).padStart(4)}`
        )
      }
      writeReport({
        mode: "dry-run",
        generated_at: new Date().toISOString(),
        summary: {
          total_targets: allTargets.length,
          queued: allTargets.length,
          concurrency,
          playwright_blocked_pass_enabled: enablePlaywrightBlockedPass,
          playwright_blocked_concurrency: playwrightBlockedConcurrency,
          playwright_blocked_limit: playwrightBlockedLimit ?? null,
          limit: limit ?? null,
          only_not_recent_minutes: onlyNotRecentMinutes ?? null,
        },
      })
      return
    }

    const startedAt = Date.now()
    const limiter = pLimit(concurrency)
    const primaryResults: CrawlResultRow[] = []
    let completed = 0

    await Promise.all(
      allTargets.map((company) =>
        limiter(async () => {
          const companyStarted = Date.now()
          process.stdout.write(`\n[full-crawl] crawling ${company.domain ?? company.id} ... `)
          try {
            const crawl = await crawlCareersPage({
              id: company.id,
              companyName: company.name,
              careersUrl: company.careers_url,
              lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
              atsType: company.ats_type,
              atsIdentifier: company.ats_identifier,
              domain: company.domain,
            })

            const persisted = await persistCrawlJobs({
              companyId: company.id,
              crawledAt: crawl.crawledAt,
              jobs: crawl.jobs,
              sourceUrl: crawl.url,
              normalizedUrl: crawl.normalizedUrl,
              diagnostics: crawl.diagnostics,
            })

            primaryResults.push({
              crawl_pass: "primary",
              company_id: company.id,
              company_name: company.name,
              domain: company.domain,
              careers_url: company.careers_url,
              ats_type: company.ats_type,
              status: "ok",
              found_jobs: crawl.jobs.length,
              inserted: persisted.inserted,
              updated: persisted.updated,
              active_count: persisted.activeCount,
              outcome_status: crawl.outcomeStatus ?? (crawl.jobs.length > 0 ? "success" : "empty"),
              outcome_reason:
                crawl.outcomeReason ?? (crawl.jobs.length > 0 ? "success" : "empty_job_list"),
              error: null,
              duration_ms: Date.now() - companyStarted,
            })

            process.stdout.write(
              `ok found=${crawl.jobs.length} inserted=${persisted.inserted} updated=${persisted.updated} active=${persisted.activeCount}`
            )
          } catch (error) {
            const message = sanitizeError(error)
            primaryResults.push({
              crawl_pass: "primary",
              company_id: company.id,
              company_name: company.name,
              domain: company.domain,
              careers_url: company.careers_url,
              ats_type: company.ats_type,
              status: "error",
              found_jobs: 0,
              inserted: 0,
              updated: 0,
              active_count: 0,
              outcome_status: "error",
              outcome_reason: "crawl_exception",
              error: message,
              duration_ms: Date.now() - companyStarted,
            })
            process.stdout.write(`error ${message}`)
          } finally {
            completed += 1
            if (completed % 25 === 0 || completed === allTargets.length) {
              process.stdout.write(`\n[full-crawl] progress ${completed}/${allTargets.length}`)
            }
          }
        })
      )
    )

    const targetsById = new Map(allTargets.map((row) => [row.id, row]))
    let blockedCandidates = primaryResults
      .filter((row) => row.found_jobs === 0 && isBlockedLikeResult(row))
      .map((row) => targetsById.get(row.company_id))
      .filter((row): row is CompanyRow => Boolean(row))
    if (playwrightBlockedLimit) blockedCandidates = blockedCandidates.slice(0, playwrightBlockedLimit)

    const playwrightBlockedResults: CrawlResultRow[] = []
    if (enablePlaywrightBlockedPass && blockedCandidates.length > 0) {
      const blockedHosts = [
        ...new Set(
          blockedCandidates
            .map((row) => parseHost(row.careers_url))
            .filter((host): host is string => Boolean(host))
        ),
      ]
      const oldPlaywrightEnabled = process.env.CRAWLER_PLAYWRIGHT_ENABLED
      const oldPlaywrightBlockedOnly = process.env.CRAWLER_PLAYWRIGHT_BLOCKED_ONLY
      const oldPlaywrightAllowlist = process.env.CRAWLER_PLAYWRIGHT_HOST_ALLOWLIST
      const oldPlaywrightMaxPerRun = process.env.CRAWLER_PLAYWRIGHT_MAX_PER_RUN
      const existingMax = Number.parseInt(oldPlaywrightMaxPerRun ?? "0", 10)
      const nextMax = Math.max(Number.isFinite(existingMax) ? existingMax : 0, blockedCandidates.length + 5)

      process.env.CRAWLER_PLAYWRIGHT_ENABLED = "true"
      process.env.CRAWLER_PLAYWRIGHT_BLOCKED_ONLY = "true"
      process.env.CRAWLER_PLAYWRIGHT_MAX_PER_RUN = String(nextMax)

      if (blockedHosts.length > 0) {
        if (!oldPlaywrightAllowlist || !oldPlaywrightAllowlist.trim()) {
          process.env.CRAWLER_PLAYWRIGHT_HOST_ALLOWLIST = blockedHosts.join(",")
        } else {
          const merged = new Set(
            oldPlaywrightAllowlist
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean)
          )
          for (const host of blockedHosts) merged.add(host)
          process.env.CRAWLER_PLAYWRIGHT_HOST_ALLOWLIST = [...merged].join(",")
        }
      }

      const blockedLimiter = pLimit(playwrightBlockedConcurrency)
      let blockedCompleted = 0
      console.log(
        `\n[full-crawl] playwright-blocked-pass targets=${blockedCandidates.length} concurrency=${playwrightBlockedConcurrency} hosts=${blockedHosts.length}`
      )

      await Promise.all(
        blockedCandidates.map((company) =>
          blockedLimiter(async () => {
            const companyStarted = Date.now()
            process.stdout.write(`\n[full-crawl] playwright recrawl ${company.domain ?? company.id} ... `)
            try {
              const crawl = await crawlCareersPage({
                id: company.id,
                companyName: company.name,
                careersUrl: company.careers_url,
                lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
                atsType: company.ats_type,
                atsIdentifier: company.ats_identifier,
                domain: company.domain,
              })

              const persisted = await persistCrawlJobs({
                companyId: company.id,
                crawledAt: crawl.crawledAt,
                jobs: crawl.jobs,
                sourceUrl: crawl.url,
                normalizedUrl: crawl.normalizedUrl,
                diagnostics: crawl.diagnostics,
              })

              playwrightBlockedResults.push({
                crawl_pass: "playwright_blocked",
                company_id: company.id,
                company_name: company.name,
                domain: company.domain,
                careers_url: company.careers_url,
                ats_type: company.ats_type,
                status: "ok",
                found_jobs: crawl.jobs.length,
                inserted: persisted.inserted,
                updated: persisted.updated,
                active_count: persisted.activeCount,
                outcome_status: crawl.outcomeStatus ?? (crawl.jobs.length > 0 ? "success" : "empty"),
                outcome_reason:
                  crawl.outcomeReason ?? (crawl.jobs.length > 0 ? "success" : "empty_job_list"),
                error: null,
                duration_ms: Date.now() - companyStarted,
              })
              process.stdout.write(
                `ok found=${crawl.jobs.length} inserted=${persisted.inserted} updated=${persisted.updated} active=${persisted.activeCount}`
              )
            } catch (error) {
              const message = sanitizeError(error)
              playwrightBlockedResults.push({
                crawl_pass: "playwright_blocked",
                company_id: company.id,
                company_name: company.name,
                domain: company.domain,
                careers_url: company.careers_url,
                ats_type: company.ats_type,
                status: "error",
                found_jobs: 0,
                inserted: 0,
                updated: 0,
                active_count: 0,
                outcome_status: "error",
                outcome_reason: "crawl_exception",
                error: message,
                duration_ms: Date.now() - companyStarted,
              })
              process.stdout.write(`error ${message}`)
            } finally {
              blockedCompleted += 1
              if (blockedCompleted % 25 === 0 || blockedCompleted === blockedCandidates.length) {
                process.stdout.write(
                  `\n[full-crawl] playwright-blocked progress ${blockedCompleted}/${blockedCandidates.length}`
                )
              }
            }
          })
        )
      )

      if (oldPlaywrightEnabled === undefined) delete process.env.CRAWLER_PLAYWRIGHT_ENABLED
      else process.env.CRAWLER_PLAYWRIGHT_ENABLED = oldPlaywrightEnabled
      if (oldPlaywrightBlockedOnly === undefined) delete process.env.CRAWLER_PLAYWRIGHT_BLOCKED_ONLY
      else process.env.CRAWLER_PLAYWRIGHT_BLOCKED_ONLY = oldPlaywrightBlockedOnly
      if (oldPlaywrightAllowlist === undefined) delete process.env.CRAWLER_PLAYWRIGHT_HOST_ALLOWLIST
      else process.env.CRAWLER_PLAYWRIGHT_HOST_ALLOWLIST = oldPlaywrightAllowlist
      if (oldPlaywrightMaxPerRun === undefined) delete process.env.CRAWLER_PLAYWRIGHT_MAX_PER_RUN
      else process.env.CRAWLER_PLAYWRIGHT_MAX_PER_RUN = oldPlaywrightMaxPerRun
    }

    const finalByCompany = new Map(primaryResults.map((row) => [row.company_id, row]))
    for (const row of playwrightBlockedResults) {
      finalByCompany.set(row.company_id, row)
    }
    const finalResults = [...finalByCompany.values()]

    const ok = finalResults.filter((r) => r.status === "ok")
    const failed = finalResults.filter((r) => r.status === "error")
    const jobsFound = ok.reduce((sum, r) => sum + r.found_jobs, 0)
    const inserted = ok.reduce((sum, r) => sum + r.inserted, 0)
    const updated = ok.reduce((sum, r) => sum + r.updated, 0)
    const activeAfter = ok.reduce((sum, r) => sum + r.active_count, 0)
    const zeroActive = finalResults.filter((r) => r.active_count === 0)
    const failedAndZero = finalResults.filter((r) => r.status === "error" && r.active_count === 0)
    const elapsedMs = Date.now() - startedAt

    console.log("\n")
    console.log(
      `[full-crawl] completed attempted=${finalResults.length} ok=${ok.length} failed=${failed.length}`
    )
    console.log(
      `[full-crawl] totals jobs_found=${jobsFound} inserted=${inserted} updated=${updated} active_jobs_after=${activeAfter}`
    )
    console.log(
      `[full-crawl] zero_active=${zeroActive.length} failed_and_zero=${failedAndZero.length} elapsed_ms=${elapsedMs}`
    )
    console.log(
      `[full-crawl] blocked-pass candidates=${blockedCandidates.length} attempted=${playwrightBlockedResults.length} recovered=${playwrightBlockedResults.filter((r) => r.status === "ok" && r.found_jobs > 0).length}`
    )

    writeReport({
      mode: "execute",
      generated_at: new Date().toISOString(),
      summary: {
        total_targets: allTargets.length,
        attempted: finalResults.length,
        primary_attempted: primaryResults.length,
        playwright_blocked_candidates: blockedCandidates.length,
        playwright_blocked_attempted: playwrightBlockedResults.length,
        playwright_blocked_recovered: playwrightBlockedResults.filter(
          (r) => r.status === "ok" && r.found_jobs > 0
        ).length,
        succeeded: ok.length,
        failed: failed.length,
        jobs_found: jobsFound,
        jobs_inserted: inserted,
        jobs_updated: updated,
        active_jobs_after_sum: activeAfter,
        zero_active_after: zeroActive.length,
        failed_and_zero_active_after: failedAndZero.length,
        elapsed_ms: elapsedMs,
        concurrency,
        limit: limit ?? null,
        only_not_recent_minutes: onlyNotRecentMinutes ?? null,
        uncaught_exception_count: uncaughtExceptionCount,
        unhandled_rejection_count: unhandledRejectionCount,
      },
      failed: failed.sort((a, b) => (a.domain ?? "").localeCompare(b.domain ?? "")),
      zero_active_after: zeroActive.sort((a, b) => (a.domain ?? "").localeCompare(b.domain ?? "")),
      failed_and_zero_active_after: failedAndZero.sort((a, b) =>
        (a.domain ?? "").localeCompare(b.domain ?? "")
      ),
      primary_results: primaryResults.sort((a, b) => (a.domain ?? "").localeCompare(b.domain ?? "")),
      playwright_blocked_results: playwrightBlockedResults.sort((a, b) =>
        (a.domain ?? "").localeCompare(b.domain ?? "")
      ),
      final_results: finalResults.sort((a, b) => (a.domain ?? "").localeCompare(b.domain ?? "")),
    })
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[full-crawl] failed", error)
  process.exit(1)
})
