/**
 * Full-system crawl for all active, crawl-allowed companies with careers URLs.
 * Non-destructive: does not deactivate companies on crawl failure.
 *
 * Usage:
 *   npx tsx scripts/crawl-all-active-companies.ts
 *   npx tsx scripts/crawl-all-active-companies.ts --execute
 *   npx tsx scripts/crawl-all-active-companies.ts --execute --concurrency=6
 *   npx tsx scripts/crawl-all-active-companies.ts --execute --limit=500
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

const execute = process.argv.includes("--execute")
const limit = Math.max(0, Number(flag("limit")) || 0) || undefined
const concurrency = Math.max(
  1,
  Number(flag("concurrency")) || Number(process.env.CRAWLER_COMPANY_CONCURRENCY) || 4
)
const onlyNotRecentMinutes = Math.max(0, Number(flag("only-not-recent-minutes")) || 0) || undefined
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
      `[full-crawl] mode=${execute ? "EXECUTE" : "dry-run"} total_targets=${allTargets.length} concurrency=${concurrency}${limit ? ` limit=${limit}` : ""}${onlyNotRecentMinutes ? ` onlyNotRecentMinutes=${onlyNotRecentMinutes}` : ""}`
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
          limit: limit ?? null,
          only_not_recent_minutes: onlyNotRecentMinutes ?? null,
        },
      })
      return
    }

    const startedAt = Date.now()
    const limiter = pLimit(concurrency)
    const results: CrawlResultRow[] = []
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

            results.push({
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
            results.push({
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

    const ok = results.filter((r) => r.status === "ok")
    const failed = results.filter((r) => r.status === "error")
    const jobsFound = ok.reduce((sum, r) => sum + r.found_jobs, 0)
    const inserted = ok.reduce((sum, r) => sum + r.inserted, 0)
    const updated = ok.reduce((sum, r) => sum + r.updated, 0)
    const activeAfter = ok.reduce((sum, r) => sum + r.active_count, 0)
    const zeroActive = results.filter((r) => r.active_count === 0)
    const failedAndZero = results.filter((r) => r.status === "error" && r.active_count === 0)
    const elapsedMs = Date.now() - startedAt

    console.log("\n")
    console.log(
      `[full-crawl] completed attempted=${results.length} ok=${ok.length} failed=${failed.length}`
    )
    console.log(
      `[full-crawl] totals jobs_found=${jobsFound} inserted=${inserted} updated=${updated} active_jobs_after=${activeAfter}`
    )
    console.log(
      `[full-crawl] zero_active=${zeroActive.length} failed_and_zero=${failedAndZero.length} elapsed_ms=${elapsedMs}`
    )

    writeReport({
      mode: "execute",
      generated_at: new Date().toISOString(),
      summary: {
        total_targets: allTargets.length,
        attempted: results.length,
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
      results: results.sort((a, b) => (a.domain ?? "").localeCompare(b.domain ?? "")),
    })
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[full-crawl] failed", error)
  process.exit(1)
})
