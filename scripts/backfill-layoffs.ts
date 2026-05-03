/**
 * One-time layoff data backfill.
 * Runs both importers then computes summaries for all companies with events.
 *
 * Usage:
 *   npx tsx scripts/backfill-layoffs.ts
 */

import { importLayoffsFyi } from "@/lib/layoffs/importers/layoffs-fyi"
import { importWarnAct }    from "@/lib/layoffs/importers/warn-act"
import { computeAllSummaries } from "@/lib/layoffs/summary-computer"
import { getPostgresPool } from "@/lib/postgres/server"

async function main() {
  console.log("=== Layoff data backfill ===\n")

  // 1. Layoffs.fyi
  console.log("[1/3] Importing layoffs.fyi…")
  try {
    const r1 = await importLayoffsFyi()
    console.log(`  rows=${r1.rowsProcessed}  new=${r1.newEvents}  dupes=${r1.duplicatesSkipped}  match_fail=${r1.matchFailures}`)
    if (r1.errors.length) console.warn("  errors:", r1.errors.slice(0, 5))
  } catch (e) {
    console.error("  layoffs.fyi failed:", e instanceof Error ? e.message : e)
  }

  // 2. WARN Act
  console.log("\n[2/3] Importing WARN Act notices…")
  try {
    const r2 = await importWarnAct()
    console.log(`  rows=${r2.rowsProcessed}  new=${r2.newEvents}  dupes=${r2.duplicatesSkipped}  match_fail=${r2.matchFailures}`)
    if (r2.errors.length) console.warn("  errors:", r2.errors.slice(0, 5))
  } catch (e) {
    console.error("  WARN Act failed:", e instanceof Error ? e.message : e)
  }

  // 3. Compute summaries for all companies with events
  console.log("\n[3/3] Computing company_layoff_summary…")
  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<{ company_id: string }>(
      `SELECT DISTINCT company_id FROM layoff_events WHERE company_id IS NOT NULL`
    )
    const ids = rows.map(r => r.company_id)
    console.log(`  ${ids.length} companies to process…`)
    const result = await computeAllSummaries(ids)
    console.log(`  computed=${result.computed}  failed=${result.failed}`)
  } catch (e) {
    console.error("  summary compute failed:", e instanceof Error ? e.message : e)
  }

  console.log("\nDone.")
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
