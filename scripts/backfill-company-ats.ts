/**
 * Backfill companies.ats_type and companies.ats_identifier from careers_url + job apply_url.
 *
 * Usage:
 *   npx tsx scripts/backfill-company-ats.ts
 *   npx tsx scripts/backfill-company-ats.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"
import { detectAts } from "../lib/companies/detect-ats"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: companies, error: companiesError } = await supabase
    .from("companies")
    .select("id, name, domain, careers_url, ats_type, ats_identifier")
    .eq("is_active", true)

  if (companiesError || !companies) {
    console.error(companiesError?.message ?? "Could not load companies")
    process.exit(1)
  }

  const { data: jobs, error: jobsError } = await supabase
    .from("jobs")
    .select("company_id, apply_url")
    .eq("is_active", true)
    .not("apply_url", "is", null)

  if (jobsError) {
    console.error(jobsError.message)
    process.exit(1)
  }

  const applyUrlsByCompany = new Map<string, string[]>()
  for (const row of jobs ?? []) {
    const companyId = row.company_id as string | null
    const applyUrl = row.apply_url as string | null
    if (!companyId || !applyUrl) continue
    const list = applyUrlsByCompany.get(companyId) ?? []
    list.push(applyUrl)
    applyUrlsByCompany.set(companyId, list)
  }

  let changed = 0
  let skipped = 0

  for (const company of companies) {
    const detected = detectAts({
      careersUrl: company.careers_url,
      applyUrls: applyUrlsByCompany.get(company.id) ?? [],
    })

    if (!detected) {
      skipped += 1
      continue
    }

    const currentType = company.ats_type ?? null
    const currentIdentifier = company.ats_identifier ?? null

    const shouldUpdateType =
      !currentType || currentType === "custom" || currentType === "unknown"
    const shouldUpdateIdentifier =
      !currentIdentifier && Boolean(detected.atsIdentifier)

    if (!shouldUpdateType && !shouldUpdateIdentifier) {
      skipped += 1
      continue
    }

    const nextType = shouldUpdateType ? detected.atsType : currentType
    const nextIdentifier = shouldUpdateIdentifier
      ? detected.atsIdentifier
      : currentIdentifier

    console.log(
      `${dryRun ? "[dry-run] " : ""}${company.name} (${company.domain}) :: ${currentType ?? "null"} -> ${nextType}${nextIdentifier ? ` (${nextIdentifier})` : ""}`
    )

    if (!dryRun) {
      const { error } = await supabase
        .from("companies")
        .update({
          ats_type: nextType,
          ats_identifier: nextIdentifier,
          updated_at: new Date().toISOString(),
        })
        .eq("id", company.id)

      if (error) {
        console.error(`  FAILED: ${error.message}`)
        continue
      }
    }

    changed += 1
  }

  console.log(
    `\nDone. ${dryRun ? "Would update" : "Updated"} ${changed} companies. Skipped ${skipped}.`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
