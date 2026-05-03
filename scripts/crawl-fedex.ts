/**
 * One-off: crawl a single company by ID.
 * Usage: npx tsx scripts/crawl-fedex.ts
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

const FEDEX_ID = "2ec1649a-cfd8-4d20-b1ee-eeca153c5b97"

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL,
    ssl: undefined,
  })

  const { rows } = await pool.query<{
    id: string; name: string; careers_url: string
    ats_type: string | null; ats_identifier: string | null; last_crawled_at: string | null
  }>(
    `SELECT id, name, careers_url, ats_type, ats_identifier, last_crawled_at
     FROM companies WHERE id = $1`,
    [FEDEX_ID]
  )

  if (!rows[0]) { console.error("FedEx not found"); process.exit(1) }
  const company = rows[0]
  console.log(`\nCrawling: ${company.name} — ${company.careers_url}`)

  const result = await crawlCareersPage({
    id: company.id,
    companyName: company.name,
    careersUrl: company.careers_url,
    lastCrawledAt: company.last_crawled_at ? new Date(company.last_crawled_at) : null,
    atsType: company.ats_type,
    atsIdentifier: company.ats_identifier,
  })

  console.log(`Crawl outcome: ${result.outcomeStatus ?? "ok"} | jobs found: ${result.jobs.length}`)

  if (result.jobs.length > 0) {
    const persisted = await persistCrawlJobs({
      companyId: company.id,
      crawledAt: result.crawledAt,
      jobs: result.jobs,
      sourceUrl: result.url,
      normalizedUrl: result.normalizedUrl,
      diagnostics: result.diagnostics,
    })
    console.log(`Inserted: ${persisted.inserted} | Updated: ${persisted.updated ?? 0}`)

    await pool.query(
      `INSERT INTO crawl_logs (company_id, status, jobs_found, new_jobs, duration_ms, crawled_at)
       VALUES ($1::uuid, 'success', $2, $3, 0, now())`,
      [company.id, result.jobs.length, persisted.inserted]
    )
  } else {
    console.warn(`No jobs returned. Reason: ${result.outcomeReason ?? "unknown"}`)
    await pool.query(
      `INSERT INTO crawl_logs (company_id, status, jobs_found, new_jobs, duration_ms, crawled_at, error_message)
       VALUES ($1::uuid, $2, 0, 0, 0, now(), $3)`,
      [company.id, result.outcomeStatus ?? "unchanged", result.outcomeReason ?? null]
    )
  }

  await pool.end()
}

main().catch((err) => { console.error(err); process.exit(1) })
