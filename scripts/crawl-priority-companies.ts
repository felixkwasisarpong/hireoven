/**
 * Crawl priority companies: iCIMS + 0-job companies with recent careers_url updates.
 *
 * Usage:
 *   npx tsx scripts/crawl-priority-companies.ts            # dry-run (list targets only)
 *   npx tsx scripts/crawl-priority-companies.ts --execute  # crawl + persist
 *   npx tsx scripts/crawl-priority-companies.ts --limit=10 --execute
 *   npx tsx scripts/crawl-priority-companies.ts --ats=icims --execute
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const limitArg = process.argv.find((a) => a.startsWith("--limit="))
const limit = limitArg ? Number(limitArg.split("=")[1]) : 50
const atsFilter = process.argv.find((a) => a.startsWith("--ats="))?.split("=")[1] ?? null

async function getPool(): Promise<Pool> {
  const connStr = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connStr) { console.error("Missing DATABASE_URL"); process.exit(1) }
  return new Pool({ connectionString: connStr, ssl: undefined })
}

async function main() {
  const pool = await getPool()
  console.log(`\n[crawl-priority] mode=${execute ? "EXECUTE" : "DRY-RUN"} limit=${limit}${atsFilter ? ` ats=${atsFilter}` : ""}`)

  // Select target companies: iCIMS type, or custom/null ATS with 0 jobs, ordered by priority.
  const atsCondition = atsFilter
    ? `c.ats_type = $1`
    : `(c.ats_type = 'icims' OR (c.job_count = 0 AND (c.ats_type IS NULL OR c.ats_type = 'custom')))`

  const params: unknown[] = []
  if (atsFilter) params.push(atsFilter)
  params.push(limit)

  const result = await pool.query<{
    id: string; name: string; careers_url: string | null
    ats_type: string | null; job_count: number; last_crawled_at: string | null
  }>(
    `SELECT id, name, careers_url, ats_type, job_count, last_crawled_at
     FROM companies c
     WHERE is_active = true
       AND careers_url IS NOT NULL
       AND careers_url != ''
       AND ${atsCondition}
     ORDER BY job_count ASC, last_crawled_at ASC NULLS FIRST
     LIMIT $${params.length}`,
    params
  )

  const targets = result.rows
  console.log(`\nTargets: ${targets.length} companies\n`)

  for (const co of targets) {
    const url = co.careers_url!
    const tag = `${co.name.slice(0, 40).padEnd(40)} [${(co.ats_type ?? "null").padEnd(10)}] jobs=${co.job_count}`

    if (!execute) {
      console.log(`  ${tag}  ${url}`)
      continue
    }

    process.stdout.write(`  Crawling ${tag}… `)
    try {
      const result = await crawlCareersPage({
        id: co.id,
        companyName: co.name,
        careersUrl: url,
        lastCrawledAt: co.last_crawled_at ? new Date(co.last_crawled_at) : null,
        atsType: co.ats_type,
      })

      const persisted = await persistCrawlJobs({
        companyId: co.id,
        crawledAt: result.crawledAt,
        jobs: result.jobs,
      })

      console.log(
        `found=${result.jobs.length} inserted=${persisted.inserted} updated=${persisted.updated} active=${persisted.activeCount}`
      )
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const summary = await pool.query<{ count: string; ats_type: string }>(
    `SELECT ats_type, COUNT(*)::text AS count
     FROM companies WHERE is_active = true AND job_count = 0
     GROUP BY ats_type ORDER BY COUNT(*) DESC`
  )
  console.log("\nRemaining 0-job companies by ATS type:")
  for (const r of summary.rows) {
    console.log(`  ${(r.ats_type ?? "null").padEnd(16)} ${r.count}`)
  }

  await pool.end()
}

main().catch((err) => {
  console.error("\ncrawl-priority-companies failed:", err)
  process.exit(1)
})
