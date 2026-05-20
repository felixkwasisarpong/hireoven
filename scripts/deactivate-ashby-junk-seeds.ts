/**
 * One-shot: deactivate companies seeded from Ashby's own subdomains
 * (academy.ashbyhq.com, docs.ashbyhq.com, sales.ashbyhq.com, …) — these
 * are Ashby's product/team pages, not real companies. Mirrors the Lever
 * deactivation in deactivate-lever-junk-seeds.ts.
 *
 *   npx tsx scripts/deactivate-ashby-junk-seeds.ts          # dry run
 *   npx tsx scripts/deactivate-ashby-junk-seeds.ts --apply  # writes is_active=false
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

const ASHBY_INTERNAL_DOMAIN_RE = /\.ashbyhq\.com$/i

async function main() {
  const apply = process.argv.includes("--apply")
  const pool = getPostgresPool()

  try {
    const { rows } = await pool.query<{
      id: string
      name: string
      careers_url: string | null
      domain: string | null
      active_job_count: number
    }>(
      `SELECT c.id, c.name, c.careers_url, c.domain,
              (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.id AND j.is_active = true) AS active_job_count
       FROM companies c
       WHERE c.status = 'active' AND c.is_active = true AND c.duplicate_of_company_id IS NULL
         AND c.ats_type = 'ashby'`
    )

    const hits = rows.filter((r) => r.domain && ASHBY_INTERNAL_DOMAIN_RE.test(r.domain))
    const withJobs = hits.filter((h) => h.active_job_count > 0)

    console.log(`Active Ashby rows scanned: ${rows.length}`)
    console.log(`*.ashbyhq.com subdomain hits: ${hits.length}`)
    console.log(`Hits with active_job_count > 0 (sanity check): ${withJobs.length}`)
    for (const h of withJobs.slice(0, 25)) {
      console.log(`  ${h.name} | jobs=${h.active_job_count} | domain=${h.domain}`)
    }

    if (hits.length === 0) {
      console.log("\nNothing to do.")
      return
    }

    if (!apply) {
      console.log(`\n[dry-run] Would set is_active=false on ${hits.length} rows.`)
      console.log(`Sample (first 10):`)
      for (const h of hits.slice(0, 10)) {
        console.log(`  ${h.name} | domain=${h.domain} | url=${h.careers_url ?? "∅"}`)
      }
      console.log(`Re-run with --apply to commit.`)
      return
    }

    const ids = hits.map((h) => h.id)
    const updated = await pool.query(
      `UPDATE companies
       SET is_active = false,
           status = 'dead'
       WHERE id = ANY($1::uuid[])`,
      [ids]
    )
    console.log(`\nDeactivated ${updated.rowCount ?? 0} rows.`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
