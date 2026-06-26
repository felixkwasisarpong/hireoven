/**
 * Find companies whose `domain` is an ATS tenant subdomain
 * (e.g. `boeing.wd1.myworkdayjobs.com`, `acme.applytojob.com`) and merge them
 * into the canonical row that owns the real brand domain (`boeing.com`,
 * `acme.com`).
 *
 * For each (duplicate → canonical) pair:
 *   1. Drop duplicate-company jobs that already exist on the canonical
 *      (same external_id), then repoint the rest via
 *      UPDATE jobs SET company_id = canonical WHERE company_id = dup.
 *   2. Repoint other foreign-key tables (watchlist, h1b_records, etc.) with
 *      delete-on-conflict for the ones that have a unique (..,company_id,..)
 *      index.
 *   3. Mark the duplicate row is_active=false and set
 *      duplicate_of_company_id = canonical.id so downstream code can skip it.
 *
 * Defaults to dry-run. Adds nothing destructive without --execute.
 *
 * Usage:
 *   npx tsx scripts/dedupe-ats-domain-companies.ts
 *   npx tsx scripts/dedupe-ats-domain-companies.ts --execute
 *   npx tsx scripts/dedupe-ats-domain-companies.ts --execute --limit=10
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")

function getArg(prefix: string): string | undefined {
  return args.find((a) => a.startsWith(prefix))?.split("=")[1]
}

const limit = Math.max(1, Number.parseInt(getArg("--limit=") ?? "10000", 10))

type DupRow = {
  dup_id: string
  dup_name: string
  dup_domain: string
  canonical_id: string
  canonical_name: string
  canonical_domain: string
  dup_job_count: number
  canonical_job_count: number
}

function brandDomainFromAts(domain: string): string | null {
  const d = domain.toLowerCase().trim()
  const wd = d.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/)
  if (wd?.[1]) return `${wd[1]}.com`
  const atj = d.match(/^([a-z0-9-]+)\.applytojob\.com$/)
  if (atj?.[1]) return `${atj[1]}.com`
  return null
}

async function findDuplicates(pool: ReturnType<typeof getPostgresPool>): Promise<DupRow[]> {
  const { rows } = await pool.query<{
    id: string
    name: string
    domain: string
    job_count: string
  }>(
    `SELECT id, name, domain, COALESCE(job_count, 0)::text AS job_count
       FROM companies
      WHERE is_active = true
        AND duplicate_of_company_id IS NULL
        AND (
          domain ~* '\\.wd[0-9]+\\.myworkdayjobs\\.com$'
          OR domain ILIKE '%.applytojob.com'
        )
      ORDER BY name
      LIMIT $1`,
    [limit]
  )

  const dups: DupRow[] = []

  for (const row of rows) {
    const brand = brandDomainFromAts(row.domain)
    if (!brand) continue

    const canonical = await pool.query<{
      id: string
      name: string
      domain: string
      job_count: string
    }>(
      `SELECT id, name, domain, COALESCE(job_count, 0)::text AS job_count
         FROM companies
        WHERE is_active = true
          AND duplicate_of_company_id IS NULL
          AND lower(domain) = lower($1)
          AND id <> $2
        LIMIT 1`,
      [brand, row.id]
    )

    const canon = canonical.rows[0]
    if (!canon) continue

    dups.push({
      dup_id: row.id,
      dup_name: row.name,
      dup_domain: row.domain,
      canonical_id: canon.id,
      canonical_name: canon.name,
      canonical_domain: canon.domain,
      dup_job_count: Number(row.job_count),
      canonical_job_count: Number(canon.job_count),
    })
  }

  return dups
}

async function mergeOne(
  pool: ReturnType<typeof getPostgresPool>,
  dup: DupRow
): Promise<{ moved_jobs: number; deleted_dup_jobs: number }> {
  const client = await pool.connect()
  let movedJobs = 0
  let deletedDupJobs = 0
  try {
    await client.query("BEGIN")

    // 1. Drop duplicate-company jobs that conflict on (company_id, external_id)
    //    with the canonical's existing jobs. These are the same posting reached
    //    via two different domains — keep the canonical's.
    const drop = await client.query(
      `DELETE FROM jobs
        WHERE company_id = $1
          AND external_id IS NOT NULL
          AND external_id IN (
            SELECT external_id FROM jobs
             WHERE company_id = $2 AND external_id IS NOT NULL
          )`,
      [dup.dup_id, dup.canonical_id]
    )
    deletedDupJobs = drop.rowCount ?? 0

    // 2. Repoint remaining jobs to canonical.
    const move = await client.query(
      `UPDATE jobs SET company_id = $1, updated_at = NOW() WHERE company_id = $2`,
      [dup.canonical_id, dup.dup_id]
    )
    movedJobs = move.rowCount ?? 0

    // 3. Repoint watchlist (drop on unique conflict).
    await client.query(
      `DELETE FROM watchlist
        WHERE company_id = $1
          AND user_id IN (SELECT user_id FROM watchlist WHERE company_id = $2)`,
      [dup.dup_id, dup.canonical_id]
    )
    await client.query(`UPDATE watchlist SET company_id = $1 WHERE company_id = $2`, [
      dup.canonical_id,
      dup.dup_id,
    ])

    // 4. Repoint application_timing_signals (drop on conflict).
    await client.query(
      `DELETE FROM application_timing_signals
        WHERE company_id = $1
          AND (day_of_week, hour_of_day) IN (
            SELECT day_of_week, hour_of_day
              FROM application_timing_signals
             WHERE company_id = $2
          )`,
      [dup.dup_id, dup.canonical_id]
    )
    await client.query(
      `UPDATE application_timing_signals SET company_id = $1 WHERE company_id = $2`,
      [dup.canonical_id, dup.dup_id]
    )

    // 5. Repoint other tables with no problematic unique-by-company constraints.
    const repointTables = [
      "h1b_records",
      "lca_records",
      "hired_outcomes",
      "post_hire_checkins",
      "rejection_submissions",
      "fair_chance_employers",
      "layoff_events",
      "employer_lca_stats",
      "employer_cohort_requests",
    ]
    for (const t of repointTables) {
      await client.query(`UPDATE ${t} SET company_id = $1 WHERE company_id = $2`, [
        dup.canonical_id,
        dup.dup_id,
      ])
    }

    // 5b. Carry the best graded sponsorship score onto the survivor (data is repointed
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
      [dup.canonical_id, dup.dup_id]
    )

    // 6. Mark duplicate inactive + point at canonical.
    await client.query(
      `UPDATE companies
          SET is_active = false,
              duplicate_of_company_id = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [dup.canonical_id, dup.dup_id]
    )

    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {})
    throw err
  } finally {
    client.release()
  }

  return { moved_jobs: movedJobs, deleted_dup_jobs: deletedDupJobs }
}

async function main() {
  const pool = getPostgresPool()
  const dups = await findDuplicates(pool)

  console.log(
    `[dedupe-ats] mode=${execute ? "execute" : "dry-run"} pairs=${dups.length}`
  )

  if (dups.length === 0) {
    await pool.end()
    return
  }

  // Dry-run preview
  for (const d of dups.slice(0, 30)) {
    console.log(
      `  ${d.dup_name} (${d.dup_domain}, ${d.dup_job_count} jobs)  →  ${d.canonical_name} (${d.canonical_domain}, ${d.canonical_job_count} jobs)`
    )
  }
  if (dups.length > 30) console.log(`  …and ${dups.length - 30} more`)

  if (!execute) {
    console.log("\n(Pass --execute to apply.)")
    await pool.end()
    return
  }

  let merged = 0
  let totalMoved = 0
  let totalDeleted = 0
  for (const d of dups) {
    try {
      const r = await mergeOne(pool, d)
      merged += 1
      totalMoved += r.moved_jobs
      totalDeleted += r.deleted_dup_jobs
      if (merged % 10 === 0) {
        console.log(`  merged=${merged}/${dups.length}`)
      }
    } catch (err) {
      console.warn(`  merge failed for ${d.dup_id} → ${d.canonical_id}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(
    `\n[dedupe-ats] done merged=${merged} jobs_moved=${totalMoved} jobs_deleted_as_dupes=${totalDeleted}`
  )
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
