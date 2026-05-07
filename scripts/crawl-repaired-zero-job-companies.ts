/**
 * Recrawl recently updated zero-job companies to verify repair impact.
 *
 * Usage:
 *   npx tsx scripts/crawl-repaired-zero-job-companies.ts
 *   npx tsx scripts/crawl-repaired-zero-job-companies.ts --execute
 *   npx tsx scripts/crawl-repaired-zero-job-companies.ts --execute --minutes=120 --concurrency=12
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

// Node 20.11 undici occasionally emits this as an unhandled rejection even
// when fetch consumers handled their own errors. Suppress only this case.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes("Controller is already closed")) return
  console.error("[repaired-zero-crawl] unhandledRejection:", reason)
  process.exit(1)
})

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500)
  return String(error).slice(0, 500)
}

const execute = process.argv.includes("--execute")
const minutes = Math.max(1, Number(flag("minutes")) || 120)
const concurrency = Math.max(1, Number(flag("concurrency")) || 12)
const limit = Math.max(0, Number(flag("limit")) || 0) || undefined
const reportPath =
  flag("report") ||
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `repaired-zero-job-crawl-report-${new Date().toISOString().slice(0, 10)}.json`
  )

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string
  ats_type: string | null
  ats_identifier: string | null
  last_crawled_at: string | null
}

type CrawlRow = {
  company_id: string
  company_name: string
  domain: string | null
  status: "ok" | "error"
  found_jobs: number
  inserted: number
  updated: number
  active_count: number
  error: string | null
}

function writeReport(payload: unknown) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  console.log(`[repaired-zero-crawl] report: ${reportPath}`)
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const limitSql = limit ? `LIMIT ${limit}` : ""
    const { rows: targets } = await pool.query<CompanyRow>(
      `SELECT id, name, domain, careers_url, ats_type, ats_identifier, last_crawled_at
       FROM companies
       WHERE is_active = true
         AND COALESCE(job_count, 0) = 0
         AND COALESCE((raw_ats_config->>'crawl_allowed')::boolean, true) = true
         AND careers_url IS NOT NULL
         AND btrim(careers_url) <> ''
         AND updated_at >= NOW() - INTERVAL '${minutes} minutes'
       ORDER BY updated_at DESC
       ${limitSql}`
    )

    console.log(
      `[repaired-zero-crawl] mode=${execute ? "EXECUTE" : "dry-run"} minutes=${minutes} targets=${targets.length} concurrency=${concurrency}${limit ? ` limit=${limit}` : ""}`
    )

    if (!execute) {
      for (const row of targets.slice(0, 80)) {
        console.log(
          `  ${(row.domain ?? "(no-domain)").padEnd(32)} ${row.name.slice(0, 36).padEnd(36)} ats=${(row.ats_type ?? "null").padEnd(12)}`
        )
      }
      writeReport({
        mode: "dry-run",
        generated_at: new Date().toISOString(),
        summary: {
          minutes,
          targets: targets.length,
          concurrency,
          limit: limit ?? null,
        },
      })
      return
    }

    const limiter = pLimit(concurrency)
    const results: CrawlRow[] = []
    const started = Date.now()

    await Promise.all(
      targets.map((company) =>
        limiter(async () => {
          process.stdout.write(`\n[repaired-zero-crawl] crawling ${company.domain ?? company.id} ... `)
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

            process.stdout.write(
              `ok found=${crawl.jobs.length} inserted=${persisted.inserted} updated=${persisted.updated} active=${persisted.activeCount}`
            )
            results.push({
              company_id: company.id,
              company_name: company.name,
              domain: company.domain,
              status: "ok",
              found_jobs: crawl.jobs.length,
              inserted: persisted.inserted,
              updated: persisted.updated,
              active_count: persisted.activeCount,
              error: null,
            })
          } catch (error) {
            const message = asErrorMessage(error)
            process.stdout.write(`error ${message}`)
            results.push({
              company_id: company.id,
              company_name: company.name,
              domain: company.domain,
              status: "error",
              found_jobs: 0,
              inserted: 0,
              updated: 0,
              active_count: 0,
              error: message,
            })
          }
        })
      )
    )

    const ok = results.filter((r) => r.status === "ok")
    const failed = results.filter((r) => r.status === "error")
    const recovered = results.filter((r) => r.status === "ok" && r.active_count > 0)
    const stillZero = results.filter((r) => r.status === "ok" && r.active_count === 0)
    const jobsFound = ok.reduce((sum, r) => sum + r.found_jobs, 0)
    const inserted = ok.reduce((sum, r) => sum + r.inserted, 0)
    const updated = ok.reduce((sum, r) => sum + r.updated, 0)

    console.log("\n")
    console.log(
      `[repaired-zero-crawl] completed attempted=${results.length} ok=${ok.length} failed=${failed.length}`
    )
    console.log(
      `[repaired-zero-crawl] recovered=${recovered.length} still_zero=${stillZero.length} jobs_found=${jobsFound} inserted=${inserted} updated=${updated} elapsed_ms=${Date.now() - started}`
    )

    writeReport({
      mode: "execute",
      generated_at: new Date().toISOString(),
      summary: {
        minutes,
        targets: targets.length,
        attempted: results.length,
        succeeded: ok.length,
        failed: failed.length,
        recovered: recovered.length,
        still_zero: stillZero.length,
        jobs_found: jobsFound,
        jobs_inserted: inserted,
        jobs_updated: updated,
        elapsed_ms: Date.now() - started,
        concurrency,
        limit: limit ?? null,
      },
      failed,
      recovered,
      still_zero: stillZero,
      results,
    })
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[repaired-zero-crawl] failed", error)
  process.exit(1)
})
