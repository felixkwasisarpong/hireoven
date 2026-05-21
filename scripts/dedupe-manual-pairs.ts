/**
 * Force-merge specific (canonical, dup) company pairs that the heuristic-based
 * dedupe flagged as ambiguous but are obvious by inspection.
 *
 * Reuses the same merge mechanics as dedupe-ats / dedupe-name.
 *
 * Usage:
 *   npx tsx scripts/dedupe-manual-pairs.ts
 *   npx tsx scripts/dedupe-manual-pairs.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")

// (canonical_id, dup_id) pairs. Verified manually before adding here.
const PAIRS: Array<{ label: string; canonical: string; dup: string }> = [
  { label: "HP Inc. ← Hp (externalcareersite.com)",
    canonical: "2db666a9-a271-40a6-8949-d6bc1b8a1398",
    dup: "426dc8cc-3964-4e85-acf6-0d3604b0921e" },
  { label: "PwC ← Pwc (usentry.com)",
    canonical: "8215f2eb-b753-44ab-a67c-3a825d128780",
    dup: "d43d90bc-fd60-4335-b3db-16509b5efb7d" },
  { label: "KLA Corporation ← Kla (annarbor.com)",
    canonical: "bef589e0-8463-4d1b-8d8c-2ff742d16e8a",
    dup: "99864a23-3d21-4dfc-b4cd-007aae37a39f" },
  { label: "Vanguard ← The Vanguard Group (thevanguard.com)",
    canonical: "4cc5311e-1675-40a4-a32a-1050136b2640",
    dup: "a1160540-0c1b-49e0-89f0-8b29bc31703f" },
]

async function mergeOne(
  pool: ReturnType<typeof getPostgresPool>,
  canonicalId: string,
  dupId: string
) {
  const client = await pool.connect()
  let moved = 0
  let deleted = 0
  try {
    await client.query("BEGIN")
    const drop = await client.query(
      `DELETE FROM jobs
        WHERE company_id = $1
          AND external_id IS NOT NULL
          AND external_id IN (
            SELECT external_id FROM jobs
             WHERE company_id = $2 AND external_id IS NOT NULL
          )`,
      [dupId, canonicalId]
    )
    deleted = drop.rowCount ?? 0
    const move = await client.query(
      `UPDATE jobs SET company_id = $1, updated_at = NOW() WHERE company_id = $2`,
      [canonicalId, dupId]
    )
    moved = move.rowCount ?? 0
    await client.query(
      `DELETE FROM watchlist
        WHERE company_id = $1
          AND user_id IN (SELECT user_id FROM watchlist WHERE company_id = $2)`,
      [dupId, canonicalId]
    )
    await client.query(`UPDATE watchlist SET company_id = $1 WHERE company_id = $2`, [canonicalId, dupId])
    await client.query(
      `DELETE FROM application_timing_signals
        WHERE company_id = $1
          AND (day_of_week, hour_of_day) IN (
            SELECT day_of_week, hour_of_day FROM application_timing_signals WHERE company_id = $2
          )`,
      [dupId, canonicalId]
    )
    await client.query(
      `UPDATE application_timing_signals SET company_id = $1 WHERE company_id = $2`,
      [canonicalId, dupId]
    )
    for (const t of [
      "h1b_records",
      "lca_records",
      "hired_outcomes",
      "post_hire_checkins",
      "rejection_submissions",
      "fair_chance_employers",
      "layoff_events",
      "employer_lca_stats",
      "employer_cohort_requests",
    ]) {
      await client.query(`UPDATE ${t} SET company_id = $1 WHERE company_id = $2`, [canonicalId, dupId])
    }
    await client.query(
      `UPDATE companies
          SET is_active = false,
              duplicate_of_company_id = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [canonicalId, dupId]
    )
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return { moved, deleted }
}

async function main() {
  const pool = getPostgresPool()
  console.log(`[dedupe-manual] mode=${execute ? "execute" : "dry-run"} pairs=${PAIRS.length}`)
  for (const p of PAIRS) console.log(`  ${p.label}`)
  if (!execute) {
    console.log("\n(Pass --execute to apply.)")
    await pool.end()
    return
  }
  let totalMoved = 0
  let totalDeleted = 0
  for (const p of PAIRS) {
    try {
      const r = await mergeOne(pool, p.canonical, p.dup)
      console.log(`  ✓ ${p.label}  moved=${r.moved} deleted=${r.deleted}`)
      totalMoved += r.moved
      totalDeleted += r.deleted
    } catch (err) {
      console.warn(`  ✗ ${p.label}:`, err instanceof Error ? err.message : err)
    }
  }
  await pool.query(
    `WITH counts AS (
       SELECT c.id, COUNT(j.*) FILTER (WHERE j.is_active = true) AS cnt
         FROM companies c LEFT JOIN jobs j ON j.company_id = c.id
        WHERE c.id = ANY($1::uuid[])
        GROUP BY c.id
     )
     UPDATE companies c SET job_count = counts.cnt, updated_at = NOW()
       FROM counts WHERE c.id = counts.id`,
    [PAIRS.map((p) => p.canonical)]
  )
  console.log(
    `\n[dedupe-manual] done jobs_moved=${totalMoved} jobs_deleted_as_dupes=${totalDeleted}`
  )
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
