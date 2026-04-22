/**
 * Bulk-insert / upsert companies (ordered seed: well-known → niche).
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Usage:
 *   npm run db:seed-companies
 *   npx tsx scripts/seed-companies.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import { createClient } from "@supabase/supabase-js"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"
import {
  COMPANY_SEED_ROWS,
  type CompanySize,
  type SeedExtra,
} from "./data/company-seeds"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")
const BATCH = 45

type InsertRow = {
  name: string
  domain: string
  careers_url: string
  logo_url: string | null
  industry: string | null
  size: CompanySize | null
  ats_type: string | null
  ats_identifier: string | null
  is_active: boolean
  sponsors_h1b: boolean
  sponsorship_confidence: number
}

function rowFromTuple(
  row:
    | readonly [string, string, string, string, CompanySize]
    | readonly [string, string, string, string, CompanySize, SeedExtra]
): InsertRow {
  const name = row[0]
  const domain = row[1]
  const careers_url = row[2]
  const industry = row[3]
  const size = row[4]
  const e: SeedExtra = row.length > 5 ? (row[5] as SeedExtra) : {}
  const sponsors = e.sponsors_h1b ?? false
  const confidence =
    typeof e.sponsorship_confidence === "number"
      ? e.sponsorship_confidence
      : sponsors
        ? 65
        : 35

  return {
    name,
    domain: domain.toLowerCase(),
    careers_url,
    logo_url: companyLogoUrlFromDomain(domain, "google-favicon"),
    industry,
    size,
    ats_type: e.ats_type ?? null,
    ats_identifier: e.ats_identifier ?? null,
    is_active: true,
    sponsors_h1b: sponsors,
    sponsorship_confidence: confidence,
  }
}

function dedupeByDomain(rows: InsertRow[]): InsertRow[] {
  const map = new Map<string, InsertRow>()
  for (const r of rows) {
    map.set(r.domain, r)
  }
  return [...map.values()]
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    process.exit(1)
  }

  const parsed = COMPANY_SEED_ROWS.map(rowFromTuple)
  const rows = dedupeByDomain(parsed)

  if (parsed.length !== rows.length) {
    console.warn(
      `Note: removed ${parsed.length - rows.length} duplicate domain row(s) from seed list`
    )
  }

  console.log(`Prepared ${rows.length} unique companies to upsert.`)

  if (dryRun) {
    console.log(rows.slice(0, 5))
    console.log("…")
    return
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await supabase.from("companies").upsert(chunk, {
      onConflict: "domain",
      ignoreDuplicates: false,
    })
    if (error) {
      console.error(`Batch ${i / BATCH + 1} failed:`, error.message)
      process.exit(1)
    }
    inserted += chunk.length
    console.log(`Upserted ${inserted} / ${rows.length}`)
  }

  console.log("Done. Run `npm run db:backfill-logo-urls` if you prefer generated favicons over Clearbit.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
