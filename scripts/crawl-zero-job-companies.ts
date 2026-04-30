/**
 * Crawl 0-job companies that have real career sites (not LinkedIn/placeholder).
 *
 * Usage:
 *   npx tsx scripts/crawl-zero-job-companies.ts            # dry-run
 *   npx tsx scripts/crawl-zero-job-companies.ts --execute  # crawl + persist
 *   npx tsx scripts/crawl-zero-job-companies.ts --limit=20 --execute
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import {
  applyCrawlQueuePolicy,
  defaultCrawlPolicyOptions,
  loadRecentCrawlSignals,
} from "@/lib/crawler/scheduling"
import { persistCrawlJobs } from "@/lib/crawler/persist"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const limitArg = process.argv.find((a) => a.startsWith("--limit="))
const limit = limitArg ? Number(limitArg.split("=")[1]) : 30

const SKIP_HOSTS = ["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com"]

async function getPool(): Promise<Pool> {
  const connStr = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connStr) { console.error("Missing DATABASE_URL"); process.exit(1) }
  return new Pool({ connectionString: connStr, ssl: undefined })
}

function isSkippableUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return SKIP_HOSTS.some((s) => host.includes(s))
  } catch { return true }
}

async function main() {
  const pool = await getPool()
  console.log(`\n[crawl-zero-job] mode=${execute ? "EXECUTE" : "DRY-RUN"} limit=${limit}`)

  const result = await pool.query<{
    id: string; name: string; careers_url: string
    ats_type: string | null; ats_identifier: string | null
    last_crawled_at: string | null; job_count: number | null
  }>(
    `SELECT id, name, careers_url, ats_type, ats_identifier, last_crawled_at, job_count
     FROM companies
     WHERE is_active = true
       AND job_count = 0
       AND careers_url IS NOT NULL
       AND careers_url != ''
       AND careers_url NOT ILIKE '%linkedin.com%'
       AND careers_url NOT ILIKE '%indeed.com%'
      AND careers_url NOT ILIKE '%ziprecruiter.com%'
      AND (ats_type IS NULL OR ats_type IN ('custom', 'workday', 'greenhouse', 'lever', 'ashby', 'bamboohr'))
     ORDER BY last_crawled_at ASC NULLS FIRST
     LIMIT $1`,
    [limit]
  )

  const signalMap = await loadRecentCrawlSignals(
    pool,
    result.rows.map((co) => co.id),
    6
  )
  const policy = applyCrawlQueuePolicy(
    result.rows,
    signalMap,
    defaultCrawlPolicyOptions({
      includeBlocked: false,
      includeDomainBroken: false,
      includeLikelyInactive: true,
    })
  )
  const targets = policy.selected.filter((co) => !isSkippableUrl(co.careers_url))
  console.log(`\nTargets: ${targets.length} companies\n`)
  console.log(
    `Lane selection: ${JSON.stringify(policy.selectedLaneCounts)} | skipped=${policy.skipped.length}`
  )

  let successCount = 0; let zeroCount = 0; let errorCount = 0

  for (const co of targets) {
    const tag = `${co.name.slice(0, 38).padEnd(38)} [${(co.ats_type ?? "null").padEnd(10)}]`

    if (!execute) {
      console.log(`  ${tag} ${co.careers_url}`)
      continue
    }

    process.stdout.write(`  Crawling ${tag}… `)
    try {
      const crawled = await crawlCareersPage({
        id: co.id,
        companyName: co.name,
        careersUrl: co.careers_url,
        lastCrawledAt: co.last_crawled_at ? new Date(co.last_crawled_at) : null,
        atsType: co.ats_type,
        atsIdentifier: co.ats_identifier,
      })

      const persisted = await persistCrawlJobs({
        companyId: co.id,
        crawledAt: crawled.crawledAt,
        jobs: crawled.jobs,
        sourceUrl: crawled.url,
        normalizedUrl: crawled.normalizedUrl,
        diagnostics: crawled.diagnostics,
      })

      console.log(`found=${crawled.jobs.length} inserted=${persisted.inserted} active=${persisted.activeCount}`)
      if (crawled.jobs.length > 0) successCount++ ; else zeroCount++
    } catch (err) {
      console.log(`ERROR: ${err instanceof Error ? err.message.slice(0, 80) : String(err)}`)
      errorCount++
    }
  }

  if (execute) {
    console.log(`\n  Results: ${successCount} found jobs, ${zeroCount} still empty, ${errorCount} errors`)
  }
  await pool.end()
}

main().catch((err) => {
  console.error("\ncrawl-zero-job-companies failed:", err)
  process.exit(1)
})
