/**
 * Targeted Workday crawl — runs crawlCareersPage + persistCrawlJobs for every
 * active Workday company sequentially. Self-heals careers_url for companies
 * still on generic URLs so the heuristic never runs again after this.
 *
 * Usage: DATABASE_URL="..." npx tsx scripts/crawl-workday.ts
 * Optional env:
 *   CRAWL_ONLY_UNRESOLVED=true  (skip companies already on myworkdayjobs.com)
 */

import { getPostgresPool } from "@/lib/postgres/server"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"

// Node.js v20 undici bug: ERR_INVALID_STATE thrown synchronously from fetch
// streams under concurrent load. Safe to ignore — the request either completed
// or was already abandoned.
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
  if (err.code === "ERR_INVALID_STATE") return
  console.error("[fatal]", err.message)
  process.exit(1)
})

const ONLY_UNRESOLVED = process.env.CRAWL_ONLY_UNRESOLVED === "true"

type CompanyRow = {
  id: string
  name: string
  careers_url: string
  ats_type: string | null
  ats_identifier: string | null
  domain: string | null
  raw_ats_config: Record<string, unknown> | null
}

async function crawlOne(company: CompanyRow): Promise<{ newJobs: number; resolved: boolean }> {
  const crawlResult = await crawlCareersPage({
    id: company.id,
    companyName: company.name,
    careersUrl: company.careers_url,
    lastCrawledAt: null,
    atsType: company.ats_type,
    atsIdentifier: company.ats_identifier,
    domain: company.domain,
  })

  const persistResult = await persistCrawlJobs({
    companyId: company.id,
    companyMeta: {
      name: company.name,
      domain: company.domain,
      careers_url: company.careers_url,
      ats_type: company.ats_type,
      raw_ats_config: company.raw_ats_config,
    },
    crawledAt: crawlResult.crawledAt,
    jobs: crawlResult.jobs,
    sourceUrl: crawlResult.url,
    normalizedUrl: crawlResult.normalizedUrl,
    resolvedCareersUrl: crawlResult.resolvedCareersUrl,
    diagnostics: crawlResult.diagnostics,
  })

  return {
    newJobs: persistResult.inserted,
    resolved: Boolean(crawlResult.resolvedCareersUrl),
  }
}

async function main() {
  const pool = getPostgresPool()
  const startedAt = Date.now()

  const whereExtra = ONLY_UNRESOLVED
    ? `AND (careers_url IS NULL OR careers_url NOT LIKE '%myworkdayjobs.com%')`
    : ""

  const result = await pool.query<CompanyRow>(
    `SELECT id, name, careers_url, ats_type, ats_identifier, domain, raw_ats_config
     FROM companies
     WHERE is_active = true
       AND ats_type = 'workday'
       AND careers_url IS NOT NULL
       ${whereExtra}
     ORDER BY last_crawled_at ASC NULLS FIRST`,
  )

  const companies = result.rows
  console.log(`\n=== Workday targeted crawl ===`)
  console.log(`Companies: ${companies.length}  OnlyUnresolved: ${ONLY_UNRESOLVED}\n`)

  let succeeded = 0
  let failed = 0
  let newJobs = 0
  let resolved = 0

  for (const company of companies) {
    const t = Date.now()
    try {
      const r = await crawlOne(company)
      succeeded++
      newJobs += r.newJobs
      if (r.resolved) resolved++
      const ms = Date.now() - t
      console.log(
        `[ok]  ${company.name.padEnd(42)} jobs_new=${String(r.newJobs).padStart(3)}${r.resolved ? " ★resolved" : ""} ${ms}ms`,
      )
    } catch (err) {
      failed++
      const ms = Date.now() - t
      const message = err instanceof Error ? err.message : String(err)
      console.log(`[err] ${company.name.padEnd(42)} ${message.slice(0, 80)} ${ms}ms`)
    }
  }

  const totalMs = Date.now() - startedAt
  const mins = Math.round(totalMs / 60000)
  console.log(`\n=== Done ===`)
  console.log(`succeeded=${succeeded}  failed=${failed}  newJobs=${newJobs}  urlsResolved=${resolved}  time=${mins}m`)

  await pool.end()
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
