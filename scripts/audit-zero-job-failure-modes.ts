/**
 * Classify active zero-job companies by live crawl outcome without writing.
 *
 * Usage:
 *   npx tsx scripts/audit-zero-job-failure-modes.ts --limit=100
 *   npx tsx scripts/audit-zero-job-failure-modes.ts --only-fetch --limit=300
 *   npx tsx scripts/audit-zero-job-failure-modes.ts --csv --limit=300
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"

loadEnvConfig(process.cwd())

const csvOnly = process.argv.includes("--csv")
const onlyFetch = process.argv.includes("--only-fetch")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = Math.max(1, Number.parseInt(limitArg?.split("=")[1] ?? "200", 10))
const concurrency = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_AUDIT_CONCURRENCY ?? "8", 10)
)

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
  job_count: number | null
}

type OutcomeRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
  outcome_status: string
  outcome_reason: string
  jobs_found: number
}

function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl:
      process.env.PGSSLMODE === "require"
        ? { rejectUnauthorized: false }
        : undefined,
  })
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

async function main() {
  const pool = getPool()
  try {
    const { rows } = await pool.query<CompanyRow>(
      `SELECT id, name, domain, careers_url, ats_type, job_count
       FROM companies
       WHERE is_active = true
         AND COALESCE(job_count, 0) = 0
         AND careers_url IS NOT NULL
         AND careers_url <> ''
       ORDER BY last_crawled_at ASC NULLS FIRST, name
       LIMIT $1`,
      [limit]
    )

    const gate = pLimit(concurrency)
    const outcomes: OutcomeRow[] = []

    await Promise.all(
      rows.map((company, idx) =>
        gate(async () => {
          const result = await crawlCareersPage({
            id: company.id,
            companyName: company.name,
            careersUrl: company.careers_url ?? "",
            lastCrawledAt: null,
            atsType: company.ats_type,
          })

          outcomes.push({
            id: company.id,
            name: company.name,
            domain: company.domain,
            careers_url: company.careers_url,
            ats_type: company.ats_type,
            outcome_status: result.outcomeStatus ?? "unknown",
            outcome_reason: result.outcomeReason ?? "unknown",
            jobs_found: result.jobs.length,
          })

          if ((idx + 1) % 25 === 0) {
            process.stdout.write(`  scanned ${idx + 1}/${rows.length}\r`)
          }
        })
      )
    )

    process.stdout.write("\n")

    outcomes.sort((a, b) => a.name.localeCompare(b.name))

    const filtered = onlyFetch
      ? outcomes.filter((row) => row.outcome_status === "fetch_error")
      : outcomes

    if (csvOnly) {
      console.log(
        [
          "id",
          "name",
          "domain",
          "ats_type",
          "careers_url",
          "outcome_status",
          "outcome_reason",
          "jobs_found",
        ]
          .map(csvEscape)
          .join(",")
      )
      for (const row of filtered) {
        console.log(
          [
            row.id,
            row.name,
            row.domain,
            row.ats_type,
            row.careers_url,
            row.outcome_status,
            row.outcome_reason,
            row.jobs_found,
          ]
            .map(csvEscape)
            .join(",")
        )
      }
      return
    }

    const byStatus = new Map<string, number>()
    const byReason = new Map<string, number>()
    for (const row of outcomes) {
      byStatus.set(row.outcome_status, (byStatus.get(row.outcome_status) ?? 0) + 1)
      byReason.set(row.outcome_reason, (byReason.get(row.outcome_reason) ?? 0) + 1)
    }

    console.log(`\nAudit sample size: ${outcomes.length}`)
    console.log("By outcome_status:")
    for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status.padEnd(12)} ${count}`)
    }

    console.log("\nTop outcome_reason:")
    for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`  ${reason.padEnd(28)} ${count}`)
    }

    if (onlyFetch) {
      console.log(`\nFetch-error rows: ${filtered.length}`)
      for (const row of filtered.slice(0, 50)) {
        console.log(
          `  ${row.name.slice(0, 34).padEnd(34)} ${row.careers_url} (${row.outcome_reason})`
        )
      }
      return
    }

    const fetchRows = outcomes.filter((row) => row.outcome_status === "fetch_error")
    const blockedRows = outcomes.filter((row) => row.outcome_status === "blocked")
    console.log(`\nBlocked rows: ${blockedRows.length}`)
    console.log(`Fetch-error rows: ${fetchRows.length}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("audit-zero-job-failure-modes failed:", error)
  process.exit(1)
})
