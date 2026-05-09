/**
 * One-off: check a company's DB status and recrawl by name pattern.
 * Usage:
 *   npx tsx scripts/check-chime.ts           # check only
 *   npx tsx scripts/check-chime.ts --execute  # check + recrawl
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL,
    ssl: undefined,
  })

  const { rows } = await pool.query<{
    id: string
    name: string
    careers_url: string | null
    ats_type: string | null
    ats_identifier: string | null
    job_count: number
    last_crawled_at: string | null
    is_active: boolean
    last_crawl_status: string | null
    last_error: string | null
  }>(
    `SELECT c.id, c.name, c.careers_url, c.ats_type, c.ats_identifier, c.job_count,
            c.last_crawled_at, c.is_active,
            (SELECT status FROM crawl_logs WHERE company_id = c.id ORDER BY crawled_at DESC LIMIT 1) AS last_crawl_status,
            (SELECT error_message FROM crawl_logs WHERE company_id = c.id ORDER BY crawled_at DESC LIMIT 1) AS last_error
     FROM companies c
     WHERE LOWER(name) LIKE '%chime%'
     ORDER BY name`
  )

  if (rows.length === 0) {
    console.error("No companies matching 'chime' found.")
    await pool.end()
    return
  }

  console.log(`\nFound ${rows.length} company/companies matching "chime":\n`)
  for (const co of rows) {
    console.log(`  Name:            ${co.name}`)
    console.log(`  ID:              ${co.id}`)
    console.log(`  Active:          ${co.is_active}`)
    console.log(`  Careers URL:     ${co.careers_url ?? "(none)"}`)
    console.log(`  ATS:             ${co.ats_type ?? "(none)"} / ${co.ats_identifier ?? "(none)"}`)
    console.log(`  Job count:       ${co.job_count}`)
    console.log(`  Last crawled:    ${co.last_crawled_at ?? "never"}`)
    console.log(`  Last status:     ${co.last_crawl_status ?? "n/a"}`)
    console.log(`  Last error:      ${co.last_error ?? "none"}`)
    console.log()
  }

  if (!execute) {
    console.log("Dry-run mode. Pass --execute to recrawl.")
    await pool.end()
    return
  }

  for (const co of rows) {
    if (!co.careers_url) {
      console.log(`Skipping ${co.name} — no careers_url.`)
      continue
    }

    console.log(`Crawling: ${co.name} — ${co.careers_url}`)
    const result = await crawlCareersPage({
      id: co.id,
      companyName: co.name,
      careersUrl: co.careers_url,
      lastCrawledAt: co.last_crawled_at ? new Date(co.last_crawled_at) : null,
      atsType: co.ats_type,
      atsIdentifier: co.ats_identifier,
    })

    console.log(`  Outcome: ${result.outcomeStatus ?? "ok"} | Jobs found: ${result.jobs.length}`)
    if (result.outcomeReason) console.log(`  Reason:  ${result.outcomeReason}`)

    if (result.jobs.length > 0) {
      const persisted = await persistCrawlJobs({
        companyId: co.id,
        crawledAt: result.crawledAt,
        jobs: result.jobs,
        sourceUrl: result.url,
        normalizedUrl: result.normalizedUrl,
        diagnostics: result.diagnostics,
      })
      console.log(`  Inserted: ${persisted.inserted} | Updated: ${persisted.updated ?? 0} | Active: ${persisted.activeCount}`)

      await pool.query(
        `INSERT INTO crawl_logs (company_id, status, jobs_found, new_jobs, duration_ms, crawled_at)
         VALUES ($1::uuid, 'success', $2, $3, 0, now())`,
        [co.id, result.jobs.length, persisted.inserted]
      )
    } else {
      console.warn(`  No jobs returned.`)
      await pool.query(
        `INSERT INTO crawl_logs (company_id, status, jobs_found, new_jobs, duration_ms, crawled_at, error_message)
         VALUES ($1::uuid, $2, 0, 0, 0, now(), $3)`,
        [co.id, result.outcomeStatus ?? "unchanged", result.outcomeReason ?? null]
      )
    }
  }

  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
