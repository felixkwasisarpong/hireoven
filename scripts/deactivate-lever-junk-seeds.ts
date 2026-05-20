/**
 * One-shot: deactivate companies that were seeded from Lever's own
 * internal/staging boards (not real companies). Three signatures:
 *
 *   - junk_uuid:           careers_url slug matches /^c-<uuid>$/
 *                          (Lever's customer-test boards)
 *   - junk_staging:        slug is a known staging keyword, or domain
 *                          ends in {staging,arepa,sandbox,qa}.lever.co
 *   - junk_lever_subdomain: domain is *.lever.co or *.hire.lever.co
 *                          (auth.lever.co, billing.lever.co, …)
 *
 * None of these represent real companies a job-seeker would care about.
 *
 *   npx tsx scripts/deactivate-lever-junk-seeds.ts          # dry run
 *   npx tsx scripts/deactivate-lever-junk-seeds.ts --apply  # writes is_active=false
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

const UUID_SLUG_RE = /^c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAGING_KEYWORDS = new Set([
  "gold","rc","tracking","chirag","partnerexperience","stagevpc",
  "z3nsandboxlaunchpad","stage","staging","test","testing","demo",
  "sandbox","internal","qa","arepa",
])
const STAGING_DOMAIN_RE = /\b(staging|arepa|sandbox|qa)\.lever\.co$/i
const LEVER_INTERNAL_DOMAIN_RE = /\.(hire\.)?lever\.co$/i

type Bucket = "junk_uuid" | "junk_staging" | "junk_lever_subdomain"

function classify(slug: string | null, domain: string | null): Bucket | null {
  const s = (slug ?? "").toLowerCase()
  const d = (domain ?? "").toLowerCase()
  if (UUID_SLUG_RE.test(s)) return "junk_uuid"
  if (STAGING_DOMAIN_RE.test(d)) return "junk_staging"
  if (LEVER_INTERNAL_DOMAIN_RE.test(d)) return "junk_lever_subdomain"
  if (STAGING_KEYWORDS.has(s)) return "junk_staging"
  return null
}

function leverSlug(careersUrl: string | null): string | null {
  if (!careersUrl) return null
  const m = careersUrl.match(/^https?:\/\/jobs\.lever\.co\/([^/?#]+)/i)
  return m ? m[1] : null
}

async function main() {
  const apply = process.argv.includes("--apply")
  const pool = getPostgresPool()

  try {
    const { rows } = await pool.query<{
      id: string
      name: string
      careers_url: string | null
      direct_ats_url: string | null
      domain: string | null
      active_job_count: number
    }>(
      `SELECT c.id, c.name, c.careers_url, c.direct_ats_url, c.domain,
              (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.id AND j.is_active = true) AS active_job_count
       FROM companies c
       WHERE c.status = 'active' AND c.is_active = true AND c.duplicate_of_company_id IS NULL
         AND c.ats_type = 'lever'`
    )

    type Hit = (typeof rows)[number] & { bucket: Bucket }
    const hits: Hit[] = []
    for (const r of rows) {
      const bucket = classify(leverSlug(r.careers_url), r.domain)
      if (bucket) hits.push({ ...r, bucket })
    }

    const byBucket = new Map<Bucket, number>()
    for (const h of hits) byBucket.set(h.bucket, (byBucket.get(h.bucket) ?? 0) + 1)
    const withJobs = hits.filter((h) => h.active_job_count > 0)

    console.log(`Active Lever rows scanned: ${rows.length}`)
    console.log(`Junk-pattern matches: ${hits.length}`)
    for (const [k, v] of [...byBucket.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(22)} ${v}`)
    }
    console.log(`\nMatches with active_job_count > 0 (sanity-check before deactivating): ${withJobs.length}`)
    for (const h of withJobs.slice(0, 25)) {
      console.log(`  ${h.name} | jobs=${h.active_job_count} | ${h.bucket} | url=${h.careers_url ?? "∅"}`)
    }

    if (hits.length === 0) {
      console.log("\nNothing to do.")
      return
    }

    if (!apply) {
      console.log(`\n[dry-run] Would set is_active=false on ${hits.length} rows.`)
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
