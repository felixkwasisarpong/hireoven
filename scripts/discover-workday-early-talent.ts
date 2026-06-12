/**
 * Discover MISSING early-talent / student / campus Workday boards for firms we
 * already harvest. Big employers expose a separate Workday *site* for interns &
 * new-grads under the same tenant (e.g. bmo: "External" + "Campus", bd:
 * "EXTERNAL_CAREER_SITE_USA" + "US_EARLY_TALENT_SITE"), but we store one site
 * per company so the intern board never gets crawled.
 *
 * For each matched Workday tenant, probe curated early-talent site names under
 * the same tenant+shard; any that return live jobs (and we don't already hold)
 * get enrolled as their own company row, tagged early_talent. Plain fetchJobs
 * probes — no browser. Job-gated (only enroll boards with >=1 live job).
 *
 *   npx tsx scripts/discover-workday-early-talent.ts                 # dry run, top 150 tenants
 *   npx tsx scripts/discover-workday-early-talent.ts --apply --limit=300
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import pLimit from "p-limit"
import { getPostgresPool } from "@/lib/postgres/server"
import { detectAdapter } from "@/lib/harvester/adapters"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"

const APPLY = process.argv.includes("--apply")
const intArg = (name: string, dflt: number) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  const n = a ? Number.parseInt(a.split("=")[1] ?? "", 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : dflt
}
const LIMIT = intArg("limit", 150)
const CONCURRENCY = intArg("concurrency", 5)

// Curated early-talent Workday site-name conventions, ordered by observed
// frequency so a hit breaks the loop early (firms with no board probe the list).
const EARLY_TALENT_SITES = [
  "Campus", "US_EARLY_TALENT_SITE", "EARLY_TALENT", "EarlyTalent", "EarlyCareers", "EarlyCareer",
  "Students", "ExternalStudents", "ExternalPrivatePostingStudents", "Student",
  "University", "UniversityCareers", "UniversityRecruiting", "UniversityRelations",
  "CampusJobs", "CampusRecruiting", "CampusCareers",
  "Interns", "Internships", "InternshipProgram", "Intern",
  "NewGrad", "Graduate", "Graduates", "GraduatePrograms", "EmergingTalent", "Scholars",
]

type Rep = { tenant: string; wd: string; name: string; logo_url: string | null; parent_id: string; job_count: number }

async function main() {
  const pool = getPostgresPool()

  // One representative (highest job_count) per Workday tenant we haven't probed,
  // whose existing site isn't itself an early-talent site.
  const { rows: reps } = await pool.query<Rep>(
    `WITH wd AS (
       SELECT id, split_part(ats_identifier,':',1) AS tenant,
              split_part(ats_identifier,':',2) AS wd,
              split_part(ats_identifier,':',3) AS site,
              name, logo_url, COALESCE(job_count,0) AS job_count, raw_ats_config
         FROM companies
        WHERE ats_type='workday' AND ats_identifier LIKE '%:%:%' AND is_active
     )
     SELECT DISTINCT ON (tenant) tenant, wd, name, logo_url, id AS parent_id, job_count
       FROM wd
      WHERE NOT COALESCE((raw_ats_config->>'early_talent_probed')::boolean, false)
        AND site !~* '(student|intern|campus|university|grad|early|scholar|talent)'
      ORDER BY tenant, job_count DESC`,
    []
  )
  reps.sort((a, b) => b.job_count - a.job_count)
  const batch = reps.slice(0, LIMIT)
  console.log(`${APPLY ? "probing+enrolling" : "DRY RUN — probing"} ${batch.length} Workday tenants for early-talent boards\n`)

  const { rows: known } = await pool.query<{ id: string }>(
    `SELECT lower(ats_identifier) AS id FROM companies WHERE ats_type='workday' AND ats_identifier IS NOT NULL`
  )
  const knownSet = new Set(known.map((r) => r.id))

  let probed = 0, found = 0, enrolled = 0
  const hits: string[] = []
  const limit = pLimit(CONCURRENCY)
  const perTenant = pLimit(2)

  await Promise.all(batch.map((rep) => limit(async () => {
    probed += 1
    let hitSite: string | null = null
    let hitJobs = 0
    let hitSlug = ""
    let hitUrl = ""

    for (const site of EARLY_TALENT_SITES) {
      const slug = `${rep.tenant}:${rep.wd}:${site}`
      if (knownSet.has(slug.toLowerCase())) continue
      const url = canonicalCareersUrl("workday", slug)
      if (!url) continue
      const det = detectAdapter(url)
      if (!det) continue
      const jobs = await perTenant(async () => {
        try {
          return (await det.adapter.fetchJobs({ slug: det.slug, ctx: { etag: null, lastModified: null, timeoutMs: 12_000 } })).jobs.length
        } catch { return -1 }
      })
      if (jobs > 0) { hitSite = site; hitJobs = jobs; hitSlug = slug; hitUrl = url; break }
    }

    if (hitSite) {
      found += 1
      hits.push(`  ${rep.name.slice(0, 26).padEnd(26)} ${hitSite.padEnd(28)} ${hitJobs} jobs`)
    }

    if (!APPLY) return

    // mark the tenant probed so re-runs skip it
    await pool.query(
      `UPDATE companies SET raw_ats_config = COALESCE(raw_ats_config,'{}'::jsonb) || '{"early_talent_probed": true}'::jsonb, updated_at = now() WHERE id = $1`,
      [rep.parent_id]
    ).catch(() => {})

    if (!hitSite) return

    const domain = `${hitSite.toLowerCase()}.${rep.tenant}.${rep.wd}.myworkdayjobs.com`
    const raw = JSON.stringify({
      source: "workday-early-talent",
      early_talent: true,
      site: hitSite,
      parent_company_id: rep.parent_id,
      discovered_job_count: hitJobs,
      created_at: new Date().toISOString(),
    })
    const r = await pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, logo_url, ats_type, ats_identifier,
          is_active, status, freshness_tier, discovered_via, raw_ats_config, next_harvest_at)
       VALUES ($1,$2,$3,$4,'workday',$5,true,'active','tier_2','script:workday-early-talent',$6::jsonb,now())
       ON CONFLICT (domain) DO NOTHING`,
      [`${rep.name} (Early Talent)`, domain, hitUrl, rep.logo_url, hitSlug, raw]
    )
    if (r.rowCount && r.rowCount > 0) enrolled += 1
  })))

  console.log(`tenants probed: ${probed}   intern boards found: ${found}   enrolled: ${APPLY ? enrolled : "(dry run)"}\n`)
  if (hits.length) { console.log(`${APPLY ? "enrolled" : "would-enroll"} early-talent boards (live jobs):`); for (const h of hits.slice(0, 40)) console.log(h) }
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
