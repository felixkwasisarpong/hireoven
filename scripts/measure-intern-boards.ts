/**
 * Read-only: sizes the "missing intern/early-talent board" opportunity for top
 * firms. Big employers run a SEPARATE Workday site for students/interns under
 * the same tenant (e.g. bdx: EXTERNAL_CAREER_SITE_USA + US_EARLY_TALENT_SITE),
 * but we store one site per company — so we never crawl the intern board.
 *
 * For the top single-site Workday firms (by job_count), probe common early-talent
 * site names under the same tenant+shard and report which resolve to a real board
 * with live jobs that we don't already hold.
 *
 *   npx tsx scripts/measure-intern-boards.ts --n=30
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"

const N = (() => {
  const a = process.argv.find((x) => x.startsWith("--n="))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : 30
  return Number.isFinite(n) && n > 0 ? n : 30
})()

// Common Workday early-talent / student site-name conventions.
const EARLY_TALENT_SITES = [
  "US_EARLY_TALENT_SITE", "EARLY_TALENT", "EarlyTalent", "EarlyCareers", "EarlyCareer",
  "Students", "ExternalStudents", "ExternalPrivatePostingStudents",
  "University", "UniversityCareers", "UniversityRecruiting", "Campus",
  "Interns", "Internships", "InternshipProgram",
  "NewGrad", "Graduate", "Graduates", "EmergingTalent", "Scholars",
]

async function main() {
  const pool = getPostgresPool()
  // Top firms where we hold exactly one Workday site for the tenant.
  const { rows } = await pool.query<{ tenant: string; wd: string; site: string; name: string; job_count: number }>(
    `WITH wd AS (
       SELECT split_part(ats_identifier,':',1) AS tenant,
              split_part(ats_identifier,':',2) AS wd,
              split_part(ats_identifier,':',3) AS site,
              name, COALESCE(job_count,0) AS job_count
         FROM companies
        WHERE ats_type='workday' AND ats_identifier LIKE '%:%:%' AND is_active
     ),
     single AS (
       SELECT tenant FROM wd GROUP BY tenant HAVING count(*)=1
     )
     SELECT DISTINCT ON (w.tenant) w.tenant, w.wd, w.site, w.name, w.job_count
       FROM wd w JOIN single s ON s.tenant=w.tenant
      WHERE w.site !~* '(student|intern|campus|university|grad|early|scholar|talent)'
      ORDER BY w.tenant, w.job_count DESC`,
    []
  )
  const firms = rows.sort((a, b) => b.job_count - a.job_count).slice(0, N)
  console.log(`probing ${firms.length} top single-site Workday firms for sibling early-talent boards\n`)

  // Boards we already have, to skip.
  const { rows: known } = await pool.query<{ id: string }>(
    `SELECT lower(ats_identifier) AS id FROM companies WHERE ats_type='workday' AND ats_identifier IS NOT NULL`
  )
  const knownSet = new Set(known.map((r) => r.id))

  let found = 0
  const hits: string[] = []
  const limit = pLimit(4)
  const perTenant = pLimit(2) // be gentle per host

  await Promise.all(firms.map((firm) => limit(async () => {
    for (const site of EARLY_TALENT_SITES) {
      const slug = `${firm.tenant}:${firm.wd}:${site}`
      if (knownSet.has(slug.toLowerCase())) continue
      const url = canonicalCareersUrl("workday", slug)
      if (!url) continue
      const det = detectAdapter(url)
      if (!det) continue
      const jobs = await perTenant(async () => {
        try {
          const r = await det.adapter.fetchJobs({ slug: det.slug, ctx: { etag: null, lastModified: null, timeoutMs: 12_000 } })
          return r.jobs.length
        } catch { return -1 }
      })
      if (jobs > 0) {
        found += 1
        hits.push(`  ${firm.name.slice(0, 24).padEnd(24)} ${site.padEnd(28)} ${jobs} jobs   (main: ${firm.site})`)
        break // one intern board per firm is enough signal
      }
    }
  })))

  console.log(`firms with a missing intern board found: ${found}/${firms.length}\n`)
  if (hits.length) { console.log("missing intern/early-talent boards (live jobs):"); for (const h of hits) console.log(h) }
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
