/**
 * Detect companies whose no-description jobs have Oracle Cloud HCM apply_urls
 * and register them in the harvester so they get properly described jobs.
 *
 * Oracle CE URLs:
 *   *.oraclecloud.com/en/sites/{site}/job/{id}          (pod-based)
 *   careers.autozone.com/en/sites/{site}/job/{id}       (custom-domain)
 *
 * Strategy:
 *   1. Find companies with active, no-description, non-harvester jobs where
 *      apply_url matches the Oracle CE URL pattern.
 *   2. Extract slug via detectAdapter (handles both pod and custom domains).
 *   3. For custom domains: probe the Oracle REST API to verify it responds.
 *   4. Update company: ats_type='oraclecloud', ats_identifier=slug,
 *      careers_url=canonical board URL, next_harvest_at=NULL.
 *
 * Usage:
 *   npx tsx scripts/backfill-oracle-companies.ts            # dry-run
 *   npx tsx scripts/backfill-oracle-companies.ts --execute  # write to DB
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { detectAdapter } from "../lib/harvester/adapters"
import { CUSTOM_HOST_PREFIX } from "../lib/harvester/adapters/oraclecloud"

const args = process.argv.slice(2)
const EXECUTE = args.includes("--execute")
const FETCH_TIMEOUT_MS = 8_000
const UA = "Mozilla/5.0 hireoven-backfill/1.0"

// Matches Oracle CE URL patterns: /en/sites/{site}/job/{id} or /hcmUI/CandidateExperience/.../sites/{site}
const ORACLE_URL_PATTERN = /\/(?:en\/sites|hcmUI\/CandidateExperience\/[^/]+\/sites)\/([A-Za-z0-9_-]+)\//

type CompanyRow = {
  id: string
  name: string
  careers_url: string
  sample_apply_url: string
  no_desc_jobs: number
}

/**
 * Probe Oracle API for a custom-domain host.
 * Returns the confirmed slug — which may differ from the input if the host
 * redirects to a canonical *.oraclecloud.com pod URL (e.g. Macy's redirects
 * www.macysjobs.com → ebwh.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001).
 * Returns null if the host does not expose a working Oracle CE API.
 */
async function probeAndResolveSlug(host: string, site: string): Promise<string | null> {
  const url = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${site},limit=1,offset=0`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: ctrl.signal,
      redirect: "follow",
    })
    if (!res.ok) return null
    // Check if the final URL is a canonical Oracle pod URL — the redirect resolves to it
    const finalUrl = res.url
    if (finalUrl && finalUrl !== url) {
      const detection = detectAdapter(finalUrl)
      if (detection?.adapter.name === "oraclecloud") return detection.slug
    }
    const text = await res.text()
    if (text.includes("requisitionList") || text.includes("TotalJobsCount") || text.includes("SearchId")) {
      // Responded on the custom domain directly
      return `${CUSTOM_HOST_PREFIX}${host}:${site}`
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function canonicalCareersUrl(slug: string): string {
  if (slug.startsWith(CUSTOM_HOST_PREFIX)) {
    const rest = slug.slice(CUSTOM_HOST_PREFIX.length)
    const idx = rest.lastIndexOf(":")
    const host = rest.slice(0, idx)
    const site = rest.slice(idx + 1)
    return `https://${host}/hcmUI/CandidateExperience/en/sites/${site}`
  }
  const idx = slug.lastIndexOf(":")
  const pod = slug.slice(0, idx)
  const site = slug.slice(idx + 1)
  return `https://${pod}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/${site}`
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

  // Find companies with no-description jobs that have Oracle-like apply_urls
  const { rows: companies } = await pool.query<CompanyRow>(`
    SELECT
      c.id,
      c.name,
      c.careers_url,
      (
        SELECT j2.apply_url
        FROM jobs j2
        WHERE j2.company_id = c.id
          AND j2.is_active = true
          AND j2.source_ats IS NULL
          AND (j2.description IS NULL OR length(j2.description) < 200)
          AND j2.apply_url ~ '/(?:en/sites|hcmUI/CandidateExperience/[^/]+/sites)/[A-Za-z0-9_-]+/'
        LIMIT 1
      ) AS sample_apply_url,
      COUNT(j.id)::int AS no_desc_jobs
    FROM companies c
    JOIN jobs j ON j.company_id = c.id
    WHERE c.is_active = true
      AND c.ats_type IS NULL
      AND j.is_active = true
      AND j.source_ats IS NULL
      AND (j.description IS NULL OR length(j.description) < 200)
      AND j.apply_url ~ '/(?:en/sites|hcmUI/CandidateExperience/[^/]+/sites)/[A-Za-z0-9_-]+/'
    GROUP BY c.id, c.name, c.careers_url
    HAVING COUNT(j.id) >= 1
    ORDER BY COUNT(j.id) DESC
  `)

  console.log(`Found ${companies.length} companies with Oracle-pattern apply_urls`)

  type PlanRow = {
    company: CompanyRow
    slug: string
    isCustomDomain: boolean
  }
  const plan: PlanRow[] = []
  let probeSkipped = 0

  for (const company of companies) {
    if (!company.sample_apply_url) continue

    const detection = detectAdapter(company.sample_apply_url)
    if (!detection || detection.adapter.name !== "oraclecloud") continue

    const slug = detection.slug
    const isCustomDomain = slug.startsWith(CUSTOM_HOST_PREFIX)

    let resolvedSlug = slug
    if (isCustomDomain) {
      // Extract host + site from slug and probe the API to verify + resolve canonical slug
      const rest = slug.slice(CUSTOM_HOST_PREFIX.length)
      const idx = rest.lastIndexOf(":")
      const host = rest.slice(0, idx)
      const site = rest.slice(idx + 1)
      const probed = await probeAndResolveSlug(host, site)
      if (!probed) {
        console.warn(`  PROBE FAILED: ${company.name} (${host}) — skipping`)
        probeSkipped++
        continue
      }
      resolvedSlug = probed
    }

    const resolvedIsCustom = resolvedSlug.startsWith(CUSTOM_HOST_PREFIX)
    plan.push({ company, slug: resolvedSlug, isCustomDomain: resolvedIsCustom })
  }

  const podBased = plan.filter((p) => !p.isCustomDomain).length
  const customDomain = plan.filter((p) => p.isCustomDomain).length
  console.log(`\nPlan: ${plan.length} companies (${podBased} pod-based, ${customDomain} custom-domain)`)
  if (probeSkipped > 0) console.log(`Probe failures skipped: ${probeSkipped}`)

  if (!EXECUTE) {
    console.log(`\n--- DRY RUN (all companies) ---`)
    for (const { company, slug, isCustomDomain } of plan) {
      const type = isCustomDomain ? "custom" : "pod"
      console.log(
        `  [${type.padEnd(7)}] ${company.name.padEnd(35)} jobs=${company.no_desc_jobs} → ${slug}`
      )
    }
    console.log("\nRe-run with --execute to write.")
    await pool.end()
    return
  }

  let updated = 0
  for (const { company, slug } of plan) {
    const careersUrl = canonicalCareersUrl(slug)
    const res = await pool.query(
      `UPDATE companies
       SET ats_type        = 'oraclecloud',
           ats_identifier  = $1,
           careers_url     = COALESCE(NULLIF(careers_url, ''), $2),
           next_harvest_at = NULL
       WHERE id = $3
         AND ats_type IS NULL`,
      [slug, careersUrl, company.id]
    )
    if (res.rowCount && res.rowCount > 0) {
      updated++
      console.log(`  Updated: ${company.name} → ${slug}`)
    }
  }

  console.log(`\nUpdated ${updated} companies → ats_type=oraclecloud, next_harvest_at reset.`)
  console.log("Harvester will pick these up on the next cycle and create described jobs.")
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
