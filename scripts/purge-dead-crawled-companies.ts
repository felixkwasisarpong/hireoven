/**
 * Remove harvestable companies that are dead boards: we crawl them every cycle
 * and get nothing. Covers two buckets — see lib/companies/purge-dead-crawled.ts
 * for the exact rules and guards (visa sponsors / h1b / fresh enrollments are
 * never touched in either):
 *   1. was-live-then-died (last_job_seen_at set, gone quiet 30+ days)
 *   2. never-confirmed-live (last_job_seen_at never set, but old + chronically
 *      empty enough that it's almost certainly a dead/misconfigured source,
 *      not a real employer we just haven't caught yet)
 *
 *   npx tsx scripts/purge-dead-crawled-companies.ts                       # dry-run, both buckets
 *   npx tsx scripts/purge-dead-crawled-companies.ts --min-empty-crawls=20 # tune floor
 *   npx tsx scripts/purge-dead-crawled-companies.ts --min-age-days=14     # tune bucket 2's age guard
 *   npx tsx scripts/purge-dead-crawled-companies.ts --no-never-live       # bucket 1 only
 *   npx tsx scripts/purge-dead-crawled-companies.ts --execute             # status='dead' (default)
 *   npx tsx scripts/purge-dead-crawled-companies.ts --execute --mode=delete
 *
 * Same engine as the /api/cron/purge-dead-crawled-companies cron.
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

const EXECUTE = process.argv.includes("--execute")
const MODE = (process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "dead") as "dead" | "delete"
const MIN_EMPTY = (() => {
  const a = process.argv.find((x) => x.startsWith("--min-empty-crawls="))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : NaN
  return Number.isFinite(n) && n >= 0 ? n : 20
})()

const INCLUDE_NEVER_LIVE = !process.argv.includes("--no-never-live")
const MIN_AGE_DAYS = (() => {
  const a = process.argv.find((x) => x.startsWith("--min-age-days="))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : NaN
  return Number.isFinite(n) && n >= 0 ? n : 14
})()

async function main() {
  const { getPostgresPool } = await import("@/lib/postgres/server")
  const {
    countDeadCrawledCompanies,
    purgeDeadCrawledCompanies,
    countNeverLiveCompanies,
    purgeNeverLiveCompanies,
  } = await import("@/lib/companies/purge-dead-crawled")
  const pool = getPostgresPool()
  const stamp = () => new Date().toISOString()

  const c = await countDeadCrawledCompanies(pool, MIN_EMPTY)
  const cNeverLive = INCLUDE_NEVER_LIVE ? await countNeverLiveCompanies(pool, MIN_EMPTY, MIN_AGE_DAYS) : 0
  const { rows: tot } = await pool.query<{ tot: number }>(`SELECT count(*)::int tot FROM companies`)
  console.log(`[${stamp()}] mode=${MODE} min_empty_crawls=${MIN_EMPTY} min_age_days=${MIN_AGE_DAYS}`)
  console.log(`[${stamp()}] was-live-then-died target: ${c} of ${tot[0]?.tot ?? 0} companies`)
  if (INCLUDE_NEVER_LIVE) {
    console.log(`[${stamp()}] never-confirmed-live target: ${cNeverLive} of ${tot[0]?.tot ?? 0} companies`)
  }

  if (!EXECUTE) {
    const sample = await pool.query<{ name: string; ats_type: string; ec: number }>(
      `SELECT name, ats_type, consecutive_empty_crawls AS ec
         FROM companies
        WHERE ats_type IS NOT NULL AND status IS DISTINCT FROM 'dead'
          AND COALESCE(sponsors_h1b,false)=false AND COALESCE(consecutive_empty_crawls,0) >= $1
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.company_id=companies.id AND j.is_active=true)
          AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.company_id=companies.id AND j.last_seen_at >= now()-interval '30 days')
          AND NOT EXISTS (SELECT 1 FROM h1b_records hr WHERE hr.company_id=companies.id)
        ORDER BY consecutive_empty_crawls DESC LIMIT 12`,
      [MIN_EMPTY],
    )
    for (const r of sample.rows) console.log(`   ${r.name?.slice(0, 40).padEnd(40)} ${r.ats_type?.padEnd(14)} empty_crawls=${r.ec}`)

    if (INCLUDE_NEVER_LIVE) {
      const sampleNeverLive = await pool.query<{ name: string; ats_type: string; ec: number }>(
        `SELECT name, ats_type, consecutive_empty_crawls AS ec
           FROM companies
          WHERE ats_type IS NOT NULL AND status IS DISTINCT FROM 'dead'
            AND COALESCE(sponsors_h1b,false)=false AND COALESCE(consecutive_empty_crawls,0) >= $1
            AND last_job_seen_at IS NULL
            AND created_at < now() - ($2 || ' days')::interval
            AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.company_id=companies.id AND j.is_active=true)
            AND NOT EXISTS (SELECT 1 FROM h1b_records hr WHERE hr.company_id=companies.id)
          ORDER BY consecutive_empty_crawls DESC LIMIT 12`,
        [MIN_EMPTY, MIN_AGE_DAYS],
      )
      console.log("   -- never-confirmed-live sample --")
      for (const r of sampleNeverLive.rows) console.log(`   ${r.name?.slice(0, 40).padEnd(40)} ${r.ats_type?.padEnd(14)} empty_crawls=${r.ec}`)
    }
    console.log("dry-run — pass --execute to apply.")
    await pool.end()
    return
  }

  const result = await purgeDeadCrawledCompanies({ pool, mode: MODE, minEmptyCrawls: MIN_EMPTY, maxBatches: 100 })
  console.log(`[${stamp()}] was-live-then-died done. ${MODE === "dead" ? "marked dead" : "hard-deleted"} ${result.affected} companies in ${result.batches} batches.`)

  if (INCLUDE_NEVER_LIVE) {
    const resultNeverLive = await purgeNeverLiveCompanies({
      pool,
      mode: MODE,
      minEmptyCrawls: MIN_EMPTY,
      minAgeDays: MIN_AGE_DAYS,
      maxBatches: 100,
    })
    console.log(`[${stamp()}] never-confirmed-live done. ${MODE === "dead" ? "marked dead" : "hard-deleted"} ${resultNeverLive.affected} companies in ${resultNeverLive.batches} batches.`)
  }
  await pool.end()
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
