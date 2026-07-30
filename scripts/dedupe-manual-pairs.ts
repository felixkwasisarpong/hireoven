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
  { label: "Allstate (allstate.com) ← Allstate (allstate:wd5:allstate_careers.workday-tenant placeholder domain)",
    canonical: "674cdd3a-0857-44fb-93ed-fe65d9ca26aa",
    dup: "a40671c5-6486-4e11-b491-135387419fcb" },
  // Wrong-survivor case: an earlier auto-dedupe pass picked the SYNTHETIC
  // placeholder-domain row as canonical and flagged the real-domain row as
  // its duplicate (without deactivating it) — the real plaid.com row kept
  // is_active=true but stopped being crawled ~1 month ago once flagged.
  // Reversing direction here: plaid.com becomes canonical, the
  // ashby-discovered placeholder becomes the (properly deactivated) dup.
  { label: "Plaid (plaid.com) ← Plaid (plaid.ashby-discovered placeholder domain) — reversing a wrong-survivor auto-dedupe",
    canonical: "275b8392-5a38-4ec7-8b39-acb924acec26",
    dup: "4aa5321c-446b-4e99-90ee-e6c9a1752370" },
  // Genuinely broken dedupe state found live: THREE active WGU rows for the
  // same Workday tenant (ats_identifier "wgu:wd5:External" on all three),
  // with a literal circular duplicate_of_company_id reference between two
  // of them (b5e7a06a -> 3d1c2cfc -> b5e7a06a) plus a third row pointing at
  // the same hub. Real institutional domain (wgu.edu) becomes canonical;
  // the raw ATS-hosted URL and the synthetic "workday-tenant" identifier-
  // as-domain rows both fold into it.
  { label: "Western Governors University (wgu.edu) ← Wgu (wgu.wd5.myworkdayjobs.com raw ATS URL) — breaking a circular dedupe reference",
    canonical: "3d1c2cfc-f9b5-4352-a85d-56e00d6e45f4",
    dup: "b5e7a06a-aecc-4ca3-8ba1-6b5192a94bfd" },
  { label: "Western Governors University (wgu.edu) ← WGU (wgu:wd5:external.workday-tenant synthetic identifier-as-domain)",
    canonical: "3d1c2cfc-f9b5-4352-a85d-56e00d6e45f4",
    dup: "9ef7d81b-2b46-4c5b-b38c-4afc8e9789a1" },
  { label: "Flock Homes (flock.com) ← Flock Homes (flockhomes.greenhouse-discovered placeholder domain)",
    canonical: "8da7b7ce-12b7-4273-bcde-737076558589",
    dup: "a0d48b9b-99d5-4116-8063-51a7bdfcf4d3" },
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
    // Carry the best graded sponsorship score onto the survivor (data is repointed
    // above, but the denormalized score lives on the company row — without this the
    // survivor keeps a stale 0 and shows grade F on the leaderboard despite filings).
    await client.query(
      `UPDATE companies can SET
          sponsorship_confidence = GREATEST(COALESCE(can.sponsorship_confidence,0), COALESCE(dup.sponsorship_confidence,0)),
          sponsors_h1b           = COALESCE(can.sponsors_h1b,false) OR COALESCE(dup.sponsors_h1b,false),
          h1b_sponsor_count_1yr  = GREATEST(COALESCE(can.h1b_sponsor_count_1yr,0), COALESCE(dup.h1b_sponsor_count_1yr,0)),
          h1b_sponsor_count_3yr  = GREATEST(COALESCE(can.h1b_sponsor_count_3yr,0), COALESCE(dup.h1b_sponsor_count_3yr,0)),
          updated_at             = NOW()
         FROM companies dup WHERE can.id=$1 AND dup.id=$2`,
      [canonicalId, dupId]
    )
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
