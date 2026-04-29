/**
 * Audit active companies that currently have 0 jobs.
 *
 * Groups results by ats_type and careers-URL shape (high / medium / low / none
 * via lib/companies/careers-url-discovery#scoreCareersUrl). Prints a summary
 * + a sample of flagged rows. No writes.
 *
 * Usage:
 *   npx tsx scripts/audit-companies-zero-jobs.ts
 *   npx tsx scripts/audit-companies-zero-jobs.ts --csv  # full CSV to stdout
 *   npx tsx scripts/audit-companies-zero-jobs.ts --limit=20
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { scoreCareersUrl } from "@/lib/companies/careers-url-discovery"
import { isTemporaryCareersUrl } from "@/lib/companies/ats-domains"

loadEnvConfig(process.cwd())

const csvOnly = process.argv.includes("--csv")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const sampleLimit = Math.max(1, Number(limitArg?.split("=")[1] ?? "30"))

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

type Row = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
  ats_identifier: string | null
  job_count: number | null
  last_crawled_at: string | null
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

async function main() {
  const pool = getPool()

  try {
    const { rows } = await pool.query<Row>(
      `SELECT id, name, domain, careers_url, ats_type, ats_identifier,
              job_count, last_crawled_at
       FROM companies
       WHERE is_active = true
         AND COALESCE(job_count, 0) = 0
       ORDER BY (last_crawled_at IS NULL) DESC, last_crawled_at ASC NULLS FIRST, name`
    )

    if (csvOnly) {
      console.log(
        [
          "id",
          "name",
          "domain",
          "ats_type",
          "ats_identifier",
          "careers_url",
          "url_confidence",
          "url_reason",
          "is_temporary_url",
          "last_crawled_at",
        ]
          .map(csvEscape)
          .join(",")
      )
      for (const row of rows) {
        const score = scoreCareersUrl(row.careers_url)
        console.log(
          [
            row.id,
            row.name,
            row.domain,
            row.ats_type,
            row.ats_identifier,
            row.careers_url,
            score.confidence,
            score.reason,
            isTemporaryCareersUrl(row.careers_url),
            row.last_crawled_at,
          ]
            .map(csvEscape)
            .join(",")
        )
      }
      return
    }

    console.log(`\n0-job audit — ${rows.length} active companies with no active jobs.\n`)

    const byAts = new Map<string, number>()
    const byConfidence = new Map<string, number>()
    let neverCrawled = 0
    let temporaryUrl = 0

    for (const row of rows) {
      const ats = row.ats_type ?? "null"
      byAts.set(ats, (byAts.get(ats) ?? 0) + 1)
      const score = scoreCareersUrl(row.careers_url)
      byConfidence.set(score.confidence, (byConfidence.get(score.confidence) ?? 0) + 1)
      if (!row.last_crawled_at) neverCrawled += 1
      if (isTemporaryCareersUrl(row.careers_url)) temporaryUrl += 1
    }

    console.log("By ATS type:")
    for (const [ats, count] of [...byAts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ats.padEnd(18)} ${count}`)
    }

    console.log("\nBy careers-URL confidence:")
    for (const [c, count] of [...byConfidence.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c.padEnd(18)} ${count}`)
    }

    console.log(`\nNever crawled:        ${neverCrawled}`)
    console.log(`Temporary/share URLs: ${temporaryUrl}`)

    console.log(`\nSample (up to ${sampleLimit}):`)
    for (const row of rows.slice(0, sampleLimit)) {
      const score = scoreCareersUrl(row.careers_url)
      console.log(
        `  [${score.confidence.padEnd(6)}] ${(row.ats_type ?? "null").padEnd(14)} ${row.name
          .slice(0, 32)
          .padEnd(32)} ${row.careers_url ?? "(none)"}`
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
