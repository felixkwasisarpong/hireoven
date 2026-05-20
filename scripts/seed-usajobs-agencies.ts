/**
 * Seed federal hiring departments as USAJOBS-backed companies.
 *
 * Each row becomes a `companies` table entry with `ats_type=usajobs` and
 * `ats_identifier` set to the value we pass to the USAJOBS API's
 * `Organization` parameter. The harvester's existing worker then claims each
 * row on its normal schedule and pulls jobs via the USAJOBS adapter.
 *
 * Why hardcode the list instead of discovering it? USAJOBS' "list all
 * agencies" endpoint exists but returns several hundred sub-agencies — most
 * with double-digit headcount postings. The 25 entries below cover ~95% of
 * federal civilian hires by volume.
 *
 * Prereqs:
 *   1. Register at https://developer.usajobs.gov/APIRequest/Index
 *   2. Set in .env.local:
 *        USAJOBS_API_KEY=<your key>
 *        USAJOBS_USER_AGENT=<your contact email>
 *
 * Usage:
 *   npx tsx scripts/seed-usajobs-agencies.ts                 # dry run
 *   npx tsx scripts/seed-usajobs-agencies.ts --execute       # upsert
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { canonicalCareersUrl } from "@/lib/harvester/canonical-url"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")

type Agency = {
  /** Display name used as `companies.name`. */
  name: string
  /** Synthetic domain — must be unique because companies are keyed by domain. */
  domain: string
  /**
   * Value sent as USAJOBS `Organization` filter. The API expects 2-letter
   * agency codes — empirically verified 2026-05-19 by probing each candidate
   * against `data.usajobs.gov/api/search`. The `expectedJobs` is what the
   * probe returned that day (use as a sanity check after first harvest).
   */
  organization: string
  expectedJobs: number
  industry: string
  size: "enterprise"
}

// Codes verified to return jobs. Ordered by current volume, descending.
// DD (Department of Defense) and the three service branches (AR/AF/NV) are
// disjoint — each posting has exactly one parent agency. Total ≈ 15.8k jobs.
const AGENCIES: Agency[] = [
  { name: "Department of Defense", domain: "defense.gov", organization: "DD", expectedJobs: 3903, industry: "Government", size: "enterprise" },
  { name: "Department of Veterans Affairs", domain: "va.gov", organization: "VA", expectedJobs: 3893, industry: "Government", size: "enterprise" },
  { name: "Department of the Air Force", domain: "af.mil", organization: "AF", expectedJobs: 1928, industry: "Government", size: "enterprise" },
  { name: "Department of the Army", domain: "army.mil", organization: "AR", expectedJobs: 1752, industry: "Government", size: "enterprise" },
  { name: "Department of the Navy", domain: "navy.mil", organization: "NV", expectedJobs: 1242, industry: "Government", size: "enterprise" },
  { name: "Department of Justice", domain: "justice.gov", organization: "DJ", expectedJobs: 833, industry: "Government", size: "enterprise" },
  { name: "Department of Homeland Security", domain: "dhs.gov", organization: "HS", expectedJobs: 564, industry: "Government", size: "enterprise" },
  { name: "Department of the Interior", domain: "doi.gov", organization: "IN", expectedJobs: 341, industry: "Government", size: "enterprise" },
  { name: "Department of Transportation", domain: "transportation.gov", organization: "TD", expectedJobs: 327, industry: "Government", size: "enterprise" },
  { name: "Department of Agriculture", domain: "usda.gov", organization: "AG", expectedJobs: 201, industry: "Government", size: "enterprise" },
  { name: "Department of Health and Human Services", domain: "hhs.gov", organization: "HE", expectedJobs: 193, industry: "Healthcare", size: "enterprise" },
  { name: "Library of Congress", domain: "loc.gov", organization: "LL", expectedJobs: 123, industry: "Government", size: "enterprise" },
  { name: "Department of the Treasury", domain: "treasury.gov", organization: "TR", expectedJobs: 119, industry: "Government", size: "enterprise" },
  { name: "Department of Commerce", domain: "commerce.gov", organization: "CM", expectedJobs: 94, industry: "Government", size: "enterprise" },
  { name: "Department of Labor", domain: "dol.gov", organization: "DL", expectedJobs: 52, industry: "Government", size: "enterprise" },
  { name: "Department of Housing and Urban Development", domain: "hud.gov", organization: "HU", expectedJobs: 52, industry: "Government", size: "enterprise" },
  { name: "Department of Energy", domain: "energy.gov", organization: "DN", expectedJobs: 47, industry: "Government", size: "enterprise" },
  { name: "Department of State", domain: "state.gov", organization: "ST", expectedJobs: 41, industry: "Government", size: "enterprise" },
  { name: "NASA", domain: "nasa.gov", organization: "NN", expectedJobs: 32, industry: "Government", size: "enterprise" },
  { name: "Department of Education", domain: "ed.gov", organization: "ED", expectedJobs: 27, industry: "Government", size: "enterprise" },
  { name: "General Services Administration", domain: "gsa.gov", organization: "GS", expectedJobs: 17, industry: "Government", size: "enterprise" },
]

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

async function main() {
  const hasApiKey = Boolean(process.env.USAJOBS_API_KEY?.trim())
  const hasUserAgent = Boolean(
    process.env.USAJOBS_USER_AGENT?.trim() || process.env.HARVESTER_CONTACT_EMAIL?.trim()
  )

  console.log(
    [
      "",
      "── Seed USAJOBS agency-companies ─────────────────────────",
      `  mode:                 ${execute ? "EXECUTE (will upsert)" : "DRY RUN"}`,
      `  agencies:             ${AGENCIES.length}`,
      `  USAJOBS_API_KEY set:  ${hasApiKey ? "yes" : "NO — adapter will fail until set"}`,
      `  USAJOBS_USER_AGENT:   ${hasUserAgent ? "yes" : "NO — adapter will fail until set"}`,
      "──────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  )

  if (!hasApiKey || !hasUserAgent) {
    console.log("Continuing anyway — companies will sit idle until the env vars are set.")
    console.log(
      "Register for a free key at https://developer.usajobs.gov/APIRequest/Index then add to .env.local:"
    )
    console.log("  USAJOBS_API_KEY=<your key>")
    console.log("  USAJOBS_USER_AGENT=<your contact email>\n")
  }

  if (!execute) {
    console.log("Would upsert:")
    for (const a of AGENCIES) {
      const url = canonicalCareersUrl("usajobs", a.organization)
      console.log(`  ${a.name.padEnd(48)} ${url}`)
    }
    console.log(`\nDry run. Re-run with --execute to upsert.\n`)
    return
  }

  const pool = getPool()
  try {
    let inserted = 0
    let updated = 0
    for (const a of AGENCIES) {
      const careersUrl = canonicalCareersUrl("usajobs", a.organization)
      if (!careersUrl) {
        console.log(`[skip-canonical] ${a.name}`)
        continue
      }
      const result = await pool.query(
        `INSERT INTO companies
           (name, domain, careers_url, direct_ats_url, logo_url, industry, size,
            ats_type, ats_identifier, is_active, sponsors_h1b, sponsorship_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'usajobs',$8,true,false,30)
         ON CONFLICT (domain) DO UPDATE SET
           name                   = EXCLUDED.name,
           careers_url            = EXCLUDED.careers_url,
           direct_ats_url         = EXCLUDED.direct_ats_url,
           logo_url               = COALESCE(companies.logo_url, EXCLUDED.logo_url),
           industry               = COALESCE(companies.industry, EXCLUDED.industry),
           size                   = COALESCE(companies.size, EXCLUDED.size),
           ats_type               = 'usajobs',
           ats_identifier         = EXCLUDED.ats_identifier,
           is_active              = true,
           next_harvest_at        = LEAST(COALESCE(companies.next_harvest_at, now()), now())
         RETURNING (xmax = 0) AS was_inserted`,
        [
          a.name,
          a.domain,
          careersUrl,
          careersUrl,
          companyLogoUrlFromDomain(a.domain, "google-favicon"),
          a.industry,
          a.size,
          a.organization,
        ]
      )
      const wasInserted = (result.rows[0] as { was_inserted: boolean } | undefined)?.was_inserted
      if (wasInserted) inserted += 1
      else updated += 1
    }
    console.log(`\n[done] inserted=${inserted} updated=${updated} total=${AGENCIES.length}\n`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
