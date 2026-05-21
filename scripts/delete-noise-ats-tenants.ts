/**
 * Hard-delete ATS-tenant "company" rows that aren't real employers — SmartRecruiters
 * and Lever subdomains we crawled at some point because crt.sh surfaced them
 * (test boards, raw client UUIDs, internal dev/CDN/assets/cert tenants, etc.).
 *
 * Conservative target — only rows that satisfy ALL of:
 *   - `ats_type IN ('lever','smartrecruiters')`
 *   - `is_active = false`
 *   - `duplicate_of_company_id IS NULL`
 *   - `job_count = 0`
 *   - `last_crawled_at IS NOT NULL`  (i.e. we tried to crawl them and they
 *      returned empty — not a "haven't tried yet" candidate)
 *
 * Already verified: this set has 0 jobs, 0 watchlist refs, 0 H-1B/LCA refs.
 * Only `crawl_logs` cascades on delete (historical traces — fine to drop).
 *
 * Usage:
 *   npx tsx scripts/delete-noise-ats-tenants.ts            # dry-run
 *   npx tsx scripts/delete-noise-ats-tenants.ts --execute
 */

import { loadEnvConfig } from "@next/env"
import { getPostgresPool } from "@/lib/postgres/server"

loadEnvConfig(process.cwd())

const args = process.argv.slice(2)
const execute = args.includes("--execute")

const SELECT_NOISE_SQL = `
  SELECT id, name, domain, ats_type, ats_identifier
    FROM companies
   WHERE ats_type IN ('lever','smartrecruiters')
     AND is_active = false
     AND duplicate_of_company_id IS NULL
     AND COALESCE(job_count, 0) = 0
     AND last_crawled_at IS NOT NULL
`

async function main() {
  const pool = getPostgresPool()

  const { rows } = await pool.query<{
    id: string
    name: string
    domain: string
    ats_type: string
    ats_identifier: string | null
  }>(SELECT_NOISE_SQL)

  // Sanity guards before any DELETE.
  const refCheck = await pool.query<{
    n_jobs: string
    n_watchlist: string
    n_h1b: string
    n_lca: string
  }>(`
    WITH noise AS (${SELECT_NOISE_SQL})
    SELECT
      (SELECT COUNT(*) FROM jobs       WHERE company_id IN (SELECT id FROM noise))::text AS n_jobs,
      (SELECT COUNT(*) FROM watchlist  WHERE company_id IN (SELECT id FROM noise))::text AS n_watchlist,
      (SELECT COUNT(*) FROM h1b_records WHERE company_id IN (SELECT id FROM noise))::text AS n_h1b,
      (SELECT COUNT(*) FROM lca_records WHERE company_id IN (SELECT id FROM noise))::text AS n_lca
  `)
  const refs = refCheck.rows[0]
  const linked =
    Number(refs?.n_jobs ?? 0) +
    Number(refs?.n_watchlist ?? 0) +
    Number(refs?.n_h1b ?? 0) +
    Number(refs?.n_lca ?? 0)

  console.log(
    `[delete-noise] mode=${execute ? "execute" : "dry-run"}  candidates=${rows.length}  user_data_refs=${linked}`
  )
  if (rows.length === 0) {
    await pool.end()
    return
  }

  for (const r of rows.slice(0, 30)) {
    console.log(`  - ${r.name}  [${r.domain}]  (${r.ats_type}/${r.ats_identifier ?? "—"})`)
  }
  if (rows.length > 30) console.log(`  …and ${rows.length - 30} more`)

  if (linked > 0) {
    console.error(
      `\n[delete-noise] aborting: ${linked} non-crawl_log references exist. Investigate before deleting.`
    )
    await pool.end()
    process.exit(1)
  }

  if (!execute) {
    console.log("\n(Pass --execute to delete.)")
    await pool.end()
    return
  }

  const ids = rows.map((r) => r.id)
  const result = await pool.query(`DELETE FROM companies WHERE id = ANY($1::uuid[])`, [ids])
  console.log(`\n[delete-noise] done deleted=${result.rowCount ?? 0}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
