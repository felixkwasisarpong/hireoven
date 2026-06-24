/**
 * Rebuild the H-1B aggregate layer from the raw lca_records table.
 *
 * Why: employer_lca_stats had gone stale (815 rows vs ~50k distinct employers in
 * lca_records; e.g. Apple showed 76 filings vs 5,595 in lca_records). That table
 * feeds company sponsorship counts, the H-1B predictor priors, and the public
 * leaderboard materialized view, so all three were running on stale numbers.
 *
 * Phases (in order):
 *   1. rebuildEmployerStats()  — aggregate lca_records → employer_lca_stats (upsert by
 *                                employer_name_normalized; carries company_id where the
 *                                lca rows are already linked).
 *   2. matchLCAToCompanies()   — link employer_lca_stats.company_id via the company-name
 *                                index AND recompute companies' denormalized sponsorship
 *                                fields (sponsors_h1b, sponsorship_confidence, counts).
 *   3. rebuildSOCBaseRates()   — rebuild SOC-code priors used by the predictor.
 *
 * Reads page lca_records in 10k chunks into THIS process (not the DB box), so prod
 * Postgres only serves sequential indexed reads + batched upserts.
 *
 * Usage:
 *   npx tsx scripts/rebuild-h1b-aggregates.ts --execute
 *
 * After this finishes, refresh the leaderboard MV:
 *   psql "$DATABASE_URL" -c "REFRESH MATERIALIZED VIEW h1b_leaderboard_mv;"
 *   (or hit /api/cron/refresh-h1b-leaderboard)
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import {
  rebuildEmployerStats,
  matchLCAToCompanies,
  rebuildSOCBaseRates,
} from "@/lib/h1b/lca-importer"
import { getPostgresPool } from "@/lib/postgres/server"

const execute = process.argv.includes("--execute")

async function count(label: string, sql: string): Promise<void> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ n: string }>(sql)
  console.log(`   ${label}: ${Number(rows[0]?.n ?? 0).toLocaleString()}`)
}

async function main(): Promise<void> {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@([^/]+).*/, "$1")
  console.log(`Target DB: ${host || "(unknown)"}`)

  console.log("\nBefore:")
  await count("employer_lca_stats rows", "SELECT COUNT(*) n FROM employer_lca_stats")
  await count(
    "  linked to a company",
    "SELECT COUNT(*) n FROM employer_lca_stats WHERE company_id IS NOT NULL"
  )
  await count(
    "  with >= 5 applications",
    "SELECT COUNT(*) n FROM employer_lca_stats WHERE total_applications >= 5"
  )

  if (!execute) {
    console.log("\n[dry run] pass --execute to rebuild. Nothing written.")
    await getPostgresPool().end()
    return
  }

  const t0 = Date.now()
  console.log("\n[1/3] rebuildEmployerStats() — aggregating lca_records ...")
  await rebuildEmployerStats()
  console.log(`      done in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const t1 = Date.now()
  console.log("[2/3] matchLCAToCompanies() — linking + recomputing company fields ...")
  await matchLCAToCompanies()
  console.log(`      done in ${((Date.now() - t1) / 1000).toFixed(1)}s`)

  const t2 = Date.now()
  console.log("[3/3] rebuildSOCBaseRates() — rebuilding SOC priors ...")
  await rebuildSOCBaseRates()
  console.log(`      done in ${((Date.now() - t2) / 1000).toFixed(1)}s`)

  console.log("\nAfter:")
  await count("employer_lca_stats rows", "SELECT COUNT(*) n FROM employer_lca_stats")
  await count(
    "  linked to a company",
    "SELECT COUNT(*) n FROM employer_lca_stats WHERE company_id IS NOT NULL"
  )
  await count(
    "  with >= 5 applications (leaderboard-eligible)",
    "SELECT COUNT(*) n FROM employer_lca_stats WHERE total_applications >= 5"
  )
  await count(
    "  >= 5 apps AND linked AND active company",
    `SELECT COUNT(*) n FROM employer_lca_stats els
       JOIN companies c ON c.id = els.company_id
      WHERE els.total_applications >= 5 AND c.is_active = true`
  )

  console.log(`\nTotal: ${((Date.now() - t0) / 1000).toFixed(1)}s. Now refresh h1b_leaderboard_mv.`)
  await getPostgresPool().end()
}

main().catch((err) => {
  console.error("rebuild-h1b-aggregates failed:", err)
  process.exit(1)
})
