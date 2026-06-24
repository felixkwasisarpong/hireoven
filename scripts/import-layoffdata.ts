/**
 * Import current WARN layoff notices from layoffdata.com public sheets into
 * layoff_events, then recompute company_layoff_summary for affected companies.
 *
 * Usage:
 *   npx tsx scripts/import-layoffdata.ts            # dry run (fetch + report, no writes)
 *   npx tsx scripts/import-layoffdata.ts --execute  # write to DB
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { importLayoffData } from "@/lib/layoffs/importers/layoffdata"
import { getPostgresPool } from "@/lib/postgres/server"

const execute = process.argv.includes("--execute")

async function count(sql: string): Promise<string> {
  const { rows } = await getPostgresPool().query<{ n: string }>(sql)
  return Number(rows[0]?.n ?? 0).toLocaleString()
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@([^/]+).*/, "$1")
  console.log(`Target DB: ${host}  (${execute ? "EXECUTE" : "dry run"})`)

  console.log("\nBefore:")
  console.log(`  layoff_events: ${await count("SELECT COUNT(*) n FROM layoff_events")}`)
  console.log(`  events in last 90d: ${await count("SELECT COUNT(*) n FROM layoff_events WHERE event_date > NOW() - INTERVAL '90 days'")}`)
  console.log(`  events in last 12mo: ${await count("SELECT COUNT(*) n FROM layoff_events WHERE event_date > NOW() - INTERVAL '12 months'")}`)

  console.log(`\nImporting (${execute ? "writing" : "dry run"}) ...`)
  const r = await importLayoffData({ dryRun: !execute })
  console.log(JSON.stringify(r, (_k, v) => (Array.isArray(v) ? v.slice(0, 5) : v), 2))

  if (execute) {
    console.log("\nAfter:")
    console.log(`  layoff_events: ${await count("SELECT COUNT(*) n FROM layoff_events")}`)
    console.log(`  events in last 90d: ${await count("SELECT COUNT(*) n FROM layoff_events WHERE event_date > NOW() - INTERVAL '90 days'")}`)
    console.log(`  events in last 12mo (linked): ${await count("SELECT COUNT(*) n FROM layoff_events WHERE company_id IS NOT NULL AND event_date > NOW() - INTERVAL '12 months'")}`)
    console.log(`  company_layoff_summary rows: ${await count("SELECT COUNT(*) n FROM company_layoff_summary")}`)
    console.log(`  summaries w/ active freeze: ${await count("SELECT COUNT(*) n FROM company_layoff_summary WHERE has_active_freeze")}`)
  }
  await getPostgresPool().end()
}
main().catch((e) => { console.error(e); process.exit(1) })
