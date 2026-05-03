/**
 * One-time health score backfill — computes scores for all companies.
 * Usage: DATABASE_URL="..." npx tsx scripts/backfill-health-scores.ts
 */

import { computeHealthScoreForAll } from "@/lib/health/score-computer"

async function main() {
  console.log("=== Employer Health Score backfill ===\n")
  console.log("Computing scores for all companies (batches of 20)…")
  const result = await computeHealthScoreForAll()
  console.log(`\nDone. computed=${result.computed}  failed=${result.failed}  durationMs=${result.durationMs}`)
  process.exit(0)
}

main().catch(e => { console.error(e); process.exit(1) })
