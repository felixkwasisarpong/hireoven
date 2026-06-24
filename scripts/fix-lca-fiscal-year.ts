/**
 * Correct lca_records.fiscal_year from the authoritative DOL case number.
 *
 * Background: decision_date in this dataset is corrupted (future-dated), and the
 * importer derived fiscal_year from it — so ~96% of rows were mislabeled FY2026/2027.
 * The case number `I-<form>-YYDDD-NNNNNN` encodes the true fiscal year of receipt
 * (e.g. I-200-25090-... → FY2025). 100% of rows have parseable case numbers.
 *
 * Phase 1 — DEDUPE: a single real LCA was imported multiple times under different
 *   (bad) fiscal years. Since the corrected FY is a function of the case number,
 *   those collapse to the same (case_number, fiscal_year) and would violate the
 *   unique index. Keep the lowest id per case number (~1,130 rows removed).
 * Phase 2 — BACKFILL: set fiscal_year = 2000 + YY(case_number), batched.
 *
 * After this: rebuild employer_lca_stats (stats_by_year is keyed by fiscal_year)
 * and refresh h1b_leaderboard_mv.
 *
 * Usage:
 *   npx tsx scripts/fix-lca-fiscal-year.ts            # dry run
 *   npx tsx scripts/fix-lca-fiscal-year.ts --execute
 */
import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { getPostgresPool } from "@/lib/postgres/server"

const execute = process.argv.includes("--execute")
const CASE_RE = `'I-[0-9]+-([0-9]{2})[0-9]{3}'`
const CORRECTED = `2000 + substring(source_case_number from ${CASE_RE})::int`

async function n(sql: string): Promise<number> {
  const { rows } = await getPostgresPool().query<{ n: string }>(sql)
  return Number(rows[0]?.n ?? 0)
}

async function main() {
  const pool = getPostgresPool()
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@([^/]+).*/, "$1")
  console.log(`Target DB: ${host}`)

  const total = await n("SELECT COUNT(*)::text n FROM lca_records")
  const dupes = await n(
    "SELECT (COUNT(*) - COUNT(DISTINCT source_case_number))::text n FROM lca_records"
  )
  const wrong = await n(
    `SELECT COUNT(*)::text n FROM lca_records
     WHERE source_case_number ~ 'I-[0-9]+-[0-9]{5}'
       AND fiscal_year IS DISTINCT FROM (${CORRECTED})`
  )
  console.log(`\nBefore: ${total.toLocaleString()} rows`)
  console.log(`  duplicate case numbers to remove: ${dupes.toLocaleString()}`)
  console.log(`  rows with wrong fiscal_year:       ${wrong.toLocaleString()}`)

  if (!execute) {
    console.log("\n[dry run] pass --execute to apply. Nothing written.")
    await pool.end()
    return
  }

  console.log("\n[1/2] Deduping duplicate case numbers (keep lowest id) ...")
  const del = await pool.query(
    `DELETE FROM lca_records a USING lca_records b
     WHERE a.source_case_number = b.source_case_number AND a.id > b.id`
  )
  console.log(`      deleted ${del.rowCount?.toLocaleString()} rows`)

  console.log("[2/2] Backfilling fiscal_year from case number (batches of 10k) ...")
  let updated = 0
  for (;;) {
    const res = await pool.query(
      `WITH cte AS (
         SELECT id FROM lca_records
         WHERE source_case_number ~ 'I-[0-9]+-[0-9]{5}'
           AND fiscal_year IS DISTINCT FROM (${CORRECTED})
         LIMIT 10000
       )
       UPDATE lca_records r SET fiscal_year = (${CORRECTED})
       FROM cte WHERE r.id = cte.id`
    )
    const c = res.rowCount ?? 0
    updated += c
    if (c > 0) process.stdout.write(`      ${updated.toLocaleString()} updated\r`)
    if (c < 10000) break
  }
  console.log(`\n      updated ${updated.toLocaleString()} rows total`)

  console.log("\nAfter — fiscal_year distribution:")
  const { rows } = await pool.query<{ fiscal_year: number; n: string }>(
    "SELECT fiscal_year, COUNT(*)::text n FROM lca_records GROUP BY 1 ORDER BY 1"
  )
  for (const r of rows) console.log(`  FY${r.fiscal_year}: ${Number(r.n).toLocaleString()}`)

  console.log("\nNext: rebuild employer_lca_stats + refresh h1b_leaderboard_mv.")
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
