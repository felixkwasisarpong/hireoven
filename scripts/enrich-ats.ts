/**
 * Detect and backfill ATS type + identifier for companies missing it.
 * Reads careers_url and active job apply_urls, runs detectAts(), writes results.
 *
 * Usage:
 *   npx tsx scripts/enrich-ats.ts            # dry run
 *   npx tsx scripts/enrich-ats.ts --execute  # write to DB
 *   npx tsx scripts/enrich-ats.ts --all      # re-check even companies that already have ATS
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())
import { Pool } from "pg"
import { detectAts } from "../lib/companies/detect-ats"

const execute = process.argv.includes("--execute")
const all = process.argv.includes("--all")

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  // Load companies (filter to missing unless --all)
  const companiesQuery = all
    ? "SELECT id, name, domain, careers_url, ats_type, ats_identifier FROM companies WHERE is_active = true ORDER BY name"
    : "SELECT id, name, domain, careers_url, ats_type, ats_identifier FROM companies WHERE is_active = true AND ats_type IS NULL ORDER BY name"

  const { rows: companies } = await pool.query<{
    id: string
    name: string
    domain: string | null
    careers_url: string | null
    ats_type: string | null
    ats_identifier: string | null
  }>(companiesQuery)

  console.log(`Checking ${companies.length} companies...`)

  // Load apply_urls grouped by company_id
  const { rows: jobRows } = await pool.query<{ company_id: string; apply_url: string }>(
    "SELECT company_id, apply_url FROM jobs WHERE is_active = true AND apply_url IS NOT NULL AND company_id IS NOT NULL"
  )
  const applyUrlsByCompany = new Map<string, string[]>()
  for (const j of jobRows) {
    const list = applyUrlsByCompany.get(j.company_id) ?? []
    list.push(j.apply_url)
    applyUrlsByCompany.set(j.company_id, list)
  }

  let updated = 0
  let skipped = 0
  let noSignal = 0

  for (const company of companies) {
    const detected = detectAts({
      careersUrl: company.careers_url,
      applyUrls: applyUrlsByCompany.get(company.id) ?? [],
    })

    if (!detected) { noSignal++; continue }

    const shouldUpdateType =
      !company.ats_type || company.ats_type === "custom" || company.ats_type === "unknown" || all
    const shouldUpdateIdentifier =
      (!company.ats_identifier && Boolean(detected.atsIdentifier)) || all

    if (!shouldUpdateType && !shouldUpdateIdentifier) { skipped++; continue }

    const nextType = shouldUpdateType ? detected.atsType : company.ats_type
    const nextIdentifier = shouldUpdateIdentifier ? detected.atsIdentifier : company.ats_identifier

    console.log(
      `${execute ? "" : "[dry] "}${company.name} (${company.domain ?? "?"}) :: ${company.ats_type ?? "null"} → ${nextType}${nextIdentifier ? ` (${nextIdentifier})` : ""}`
    )

    if (execute) {
      await pool.query(
        "UPDATE companies SET ats_type = $1, ats_identifier = $2, updated_at = NOW() WHERE id = $3",
        [nextType, nextIdentifier, company.id]
      )
    }
    updated++
  }

  console.log(
    `\n${execute ? "Updated" : "Would update"}: ${updated} | No signal: ${noSignal} | Already set/unchanged: ${skipped}`
  )
  if (!execute) console.log("Re-run with --execute to apply.")
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
