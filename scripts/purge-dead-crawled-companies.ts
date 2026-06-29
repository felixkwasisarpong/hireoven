/**
 * Remove harvestable companies that are dead boards: we crawl them every cycle
 * and get nothing. See lib/companies/purge-dead-crawled.ts for the exact rule
 * and guards (visa sponsors / h1b / fresh enrollments are never touched).
 *
 *   npx tsx scripts/purge-dead-crawled-companies.ts                       # dry-run
 *   npx tsx scripts/purge-dead-crawled-companies.ts --min-empty-crawls=20 # tune floor
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

async function main() {
  const { getPostgresPool } = await import("@/lib/postgres/server")
  const { countDeadCrawledCompanies, purgeDeadCrawledCompanies } = await import("@/lib/companies/purge-dead-crawled")
  const pool = getPostgresPool()
  const stamp = () => new Date().toISOString()

  const c = await countDeadCrawledCompanies(pool, MIN_EMPTY)
  const { rows: tot } = await pool.query<{ tot: number }>(`SELECT count(*)::int tot FROM companies`)
  console.log(`[${stamp()}] mode=${MODE} min_empty_crawls=${MIN_EMPTY}`)
  console.log(`[${stamp()}] target: ${c} of ${tot[0]?.tot ?? 0} companies`)

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
    console.log("dry-run — pass --execute to apply.")
    await pool.end()
    return
  }

  const result = await purgeDeadCrawledCompanies({ pool, mode: MODE, minEmptyCrawls: MIN_EMPTY, maxBatches: 100 })
  console.log(`[${stamp()}] done. ${MODE === "dead" ? "marked dead" : "hard-deleted"} ${result.affected} companies in ${result.batches} batches.`)
  await pool.end()
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
