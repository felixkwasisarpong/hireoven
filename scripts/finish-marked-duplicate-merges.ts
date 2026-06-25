/**
 * Complete merges for rows that were marked `duplicate_of_company_id` by an earlier
 * pass but left `is_active = true` (flag drift). The dedup clusterer skips these
 * (it filters `duplicate_of_company_id IS NULL`), so their jobs/FK rows were never
 * repointed. This replays the same merge mechanics as dedupe-name-based-companies.ts
 * (mergeOne) for each explicit (dup -> canonical) pair, then deactivates the dup.
 *
 * Only processes pairs whose canonical is itself ACTIVE (safe; skips ~25 whose
 * canonical is inactive — those need manual attention).
 *
 *   npx tsx scripts/finish-marked-duplicate-merges.ts            # dry-run
 *   npx tsx scripts/finish-marked-duplicate-merges.ts --execute
 */
import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

const EXECUTE = process.argv.includes("--execute")

const REPOINT_TABLES = [
  "h1b_records", "lca_records", "hired_outcomes", "post_hire_checkins",
  "rejection_submissions", "fair_chance_employers", "layoff_events",
  "employer_lca_stats", "employer_cohort_requests",
]

async function mergeOne(pool: any, canonicalId: string, dupId: string) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    await client.query(
      `UPDATE companies can SET
          careers_url=COALESCE(NULLIF(can.careers_url,''),dup.careers_url),
          direct_ats_url=dup.direct_ats_url, direct_ats_provider=dup.direct_ats_provider,
          ats_type=COALESCE(NULLIF(can.ats_type,''),dup.ats_type), ats_identifier=dup.ats_identifier,
          raw_ats_config=dup.raw_ats_config, next_harvest_at=NOW(), updated_at=NOW()
         FROM companies dup
        WHERE can.id=$1 AND dup.id=$2
          AND COALESCE(NULLIF(can.ats_identifier,''),'')='' AND COALESCE(NULLIF(can.direct_ats_url,''),'')=''
          AND COALESCE(NULLIF(dup.ats_identifier,''),NULLIF(dup.direct_ats_url,''),'')<>''`,
      [canonicalId, dupId]
    )
    await client.query(
      `DELETE FROM jobs WHERE company_id=$1 AND external_id IS NOT NULL
         AND external_id IN (SELECT external_id FROM jobs WHERE company_id=$2 AND external_id IS NOT NULL)`,
      [dupId, canonicalId]
    )
    await client.query(`UPDATE jobs SET company_id=$1, updated_at=NOW() WHERE company_id=$2`, [canonicalId, dupId])
    await client.query(
      `DELETE FROM watchlist WHERE company_id=$1 AND user_id IN (SELECT user_id FROM watchlist WHERE company_id=$2)`,
      [dupId, canonicalId]
    )
    await client.query(`UPDATE watchlist SET company_id=$1 WHERE company_id=$2`, [canonicalId, dupId])
    await client.query(
      `DELETE FROM application_timing_signals WHERE company_id=$1 AND (day_of_week,hour_of_day) IN
         (SELECT day_of_week,hour_of_day FROM application_timing_signals WHERE company_id=$2)`,
      [dupId, canonicalId]
    )
    await client.query(`UPDATE application_timing_signals SET company_id=$1 WHERE company_id=$2`, [canonicalId, dupId])
    for (const t of REPOINT_TABLES) {
      await client.query(`UPDATE ${t} SET company_id=$1 WHERE company_id=$2`, [canonicalId, dupId])
    }
    await client.query(
      `UPDATE companies SET is_active=false, duplicate_of_company_id=$1, next_harvest_at=NULL, updated_at=NOW() WHERE id=$2`,
      [canonicalId, dupId]
    )
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

async function main() {
  const { getPostgresPool } = await import("@/lib/postgres/server")
  const pool = getPostgresPool()
  const stamp = () => new Date().toISOString()

  const { rows: pairs } = await pool.query<{ dup: string; canon: string; dname: string; cname: string }>(
    `SELECT d.id dup, c.id canon, d.name dname, c.name cname
     FROM companies d JOIN companies c ON c.id = d.duplicate_of_company_id
     WHERE d.is_active = true AND c.is_active = true AND c.id <> d.id`
  )
  console.log(`[${stamp()}] pairs to finish (active dup -> active canonical): ${pairs.length}`)
  console.log(pairs.slice(0, 10).map((p) => `  ${p.dname} -> ${p.cname}`).join("\n"))

  if (!EXECUTE) {
    console.log("dry-run — pass --execute to complete the merges.")
    return
  }

  let done = 0, failed = 0
  const touched = new Set<string>()
  for (const p of pairs) {
    try {
      await mergeOne(pool, p.canon, p.dup)
      touched.add(p.canon)
      if (++done % 200 === 0) console.log(`[${stamp()}] ${done}/${pairs.length}…`)
    } catch (e) {
      failed++
      console.warn(`fail ${p.dname} -> ${p.cname}: ${e instanceof Error ? e.message : e}`)
    }
  }
  // Recompute job_count for the canonicals we moved jobs into.
  if (touched.size) {
    await pool.query(
      `UPDATE companies c SET job_count = (SELECT count(*) FROM jobs j WHERE j.company_id = c.id), updated_at = NOW()
       WHERE c.id = ANY($1::uuid[])`,
      [[...touched]]
    )
  }
  await pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY h1b_leaderboard_mv").catch((e) => console.warn("MV refresh:", e.message))
  console.log(`[${stamp()}] done. completed ${done}, failed ${failed}, canonicals refreshed ${touched.size}.`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
