/**
 * Set companies.logo_url from each row's domain (Clearbit / Unavatar / Google favicon).
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   npx tsx scripts/backfill-company-logo-urls.ts --dry-run
 *   npx tsx scripts/backfill-company-logo-urls.ts
 *   npx tsx scripts/backfill-company-logo-urls.ts --force
 *   npx tsx scripts/backfill-company-logo-urls.ts --provider=unavatar
 */

import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"
import {
  companyLogoUrlFromDomain,
  normalizeCompanyDomain,
  type LogoProvider,
} from "../lib/companies/logo-url"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")
const force = process.argv.includes("--force")

function getProvider(): LogoProvider {
  const arg = process.argv.find((a) => a.startsWith("--provider="))
  const v = arg?.split("=")[1]?.toLowerCase()
  if (v === "unavatar" || v === "google-favicon" || v === "clearbit") return v
  return "google-favicon"
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }

  const provider = getProvider()
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: companies, error } = await supabase
    .from("companies")
    .select("id, name, domain, logo_url")

  if (error || !companies) {
    console.error(error?.message ?? "No companies")
    process.exit(1)
  }

  let updated = 0
  let skipped = 0

  for (const row of companies) {
    const domain = normalizeCompanyDomain(row.domain)
    if (!domain) {
      console.warn(`Skip ${row.name}: empty domain`)
      skipped++
      continue
    }

    const next = companyLogoUrlFromDomain(domain, provider)
    const prev = row.logo_url?.trim() ?? ""

    if (!force && prev) {
      skipped++
      continue
    }

    if (prev === next) {
      skipped++
      continue
    }

    console.log(
      `${dryRun ? "[dry-run] " : ""}${row.name} (${domain})\n  ${prev || "(null)"}\n  → ${next}`
    )

    if (!dryRun) {
      const { error: uErr } = await supabase
        .from("companies")
        .update({ logo_url: next, updated_at: new Date().toISOString() })
        .eq("id", row.id)
      if (uErr) console.error(`  FAILED: ${uErr.message}`)
      else updated++
    } else {
      updated++
    }
  }

  console.log(
    `\nProvider: ${provider}${force ? " (force overwrite)" : ""}\n` +
      `Done. ${dryRun ? "Would update" : "Updated"}: ${updated}, skipped: ${skipped}, total: ${companies.length}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
