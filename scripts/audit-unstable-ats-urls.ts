/**
 * Audit companies and jobs whose URLs carry transient/share signals
 * (validityToken, /embed/, /share/, etc.). These URLs reflect a single
 * browsing session and must never be persisted as a canonical careers URL.
 *
 * Usage:
 *   npx tsx scripts/audit-unstable-ats-urls.ts
 *   npx tsx scripts/audit-unstable-ats-urls.ts --csv
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { isTemporaryCareersUrl } from "@/lib/companies/ats-domains"

loadEnvConfig(process.cwd())

const csvOnly = process.argv.includes("--csv")

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

const TEMPORARY_LIKE_FILTER = `(
  careers_url ILIKE '%validityToken%' OR
  careers_url ILIKE '%/embed%' OR
  careers_url ILIKE '%/share/%' OR
  careers_url ILIKE '%token=%' OR
  careers_url ILIKE '%signature=%' OR
  careers_url ILIKE '%expires=%'
)`

const TEMPORARY_LIKE_FILTER_JOBS = `(
  apply_url ILIKE '%validityToken%' OR
  apply_url ILIKE '%/embed%' OR
  apply_url ILIKE '%/share/%' OR
  apply_url ILIKE '%token=%' OR
  apply_url ILIKE '%signature=%' OR
  apply_url ILIKE '%expires=%'
)`

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

async function main() {
  const pool = getPool()

  try {
    const companies = await pool.query<{
      id: string
      name: string
      domain: string | null
      careers_url: string | null
      ats_type: string | null
    }>(
      `SELECT id, name, domain, careers_url, ats_type
       FROM companies
       WHERE is_active = true AND careers_url IS NOT NULL AND ${TEMPORARY_LIKE_FILTER}`
    )
    const jobs = await pool.query<{
      id: string
      company_id: string
      title: string
      apply_url: string
    }>(
      `SELECT id, company_id, title, apply_url
       FROM jobs
       WHERE is_active = true AND ${TEMPORARY_LIKE_FILTER_JOBS}
       LIMIT 500`
    )

    const flaggedCompanies = companies.rows.filter((row) =>
      isTemporaryCareersUrl(row.careers_url)
    )
    const flaggedJobs = jobs.rows.filter((row) =>
      isTemporaryCareersUrl(row.apply_url)
    )

    if (csvOnly) {
      console.log(
        ["scope", "id", "name_or_title", "url"].map(csvEscape).join(",")
      )
      for (const row of flaggedCompanies) {
        console.log(
          ["company", row.id, row.name, row.careers_url].map(csvEscape).join(",")
        )
      }
      for (const row of flaggedJobs) {
        console.log(
          ["job", row.id, row.title, row.apply_url].map(csvEscape).join(",")
        )
      }
      return
    }

    console.log(`\nUnstable URL audit`)
    console.log(`  Companies with transient careers_url: ${flaggedCompanies.length}`)
    console.log(`  Jobs with transient apply_url:       ${flaggedJobs.length}`)

    if (flaggedCompanies.length > 0) {
      console.log(`\nSample companies (up to 20):`)
      for (const row of flaggedCompanies.slice(0, 20)) {
        console.log(
          `  ${row.name.slice(0, 36).padEnd(36)} [${row.ats_type ?? "null"}] ${row.careers_url}`
        )
      }
    }
    if (flaggedJobs.length > 0) {
      console.log(`\nSample jobs (up to 20):`)
      for (const row of flaggedJobs.slice(0, 20)) {
        console.log(`  ${row.title.slice(0, 40).padEnd(40)} ${row.apply_url}`)
      }
    }

    console.log(
      "\nThese URLs are now rejected by normalizeAtsUrl (shouldPersist=false).\n" +
        "Run scripts/preview-careers-url-repairs.ts to derive replacements."
    )
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
