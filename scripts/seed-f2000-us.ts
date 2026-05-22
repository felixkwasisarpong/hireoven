/**
 * Insert F2000 US gap-fill companies from company-seeds-f2000-us.ts.
 *
 * Safety:
 *   - DRY RUN by default; --execute to write.
 *   - Dedupes by domain across the seed file.
 *   - Skips any seed whose domain already exists in `companies`.
 *   - Uses ATS detection on the careers_url to populate ats_type.
 *
 * Usage:
 *   npx tsx scripts/seed-f2000-us.ts                # dry run
 *   npx tsx scripts/seed-f2000-us.ts --execute      # write
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"
import { detectAtsFromUrl } from "../lib/companies/detect-ats"
import { F2000_US_GAP_FILL_ROWS } from "./data/company-seeds-f2000-us"

const execute = process.argv.includes("--execute")
const PLACEHOLDER_DOMAINS = new Set(["REMOVED-PLACEHOLDER", "REMOVED-PLACEHOLDER-2"])

type Row = {
  name: string
  domain: string
  careers_url: string
  industry: string
  size: string
  logo_url: string | null
  ats_type: string | null
  ats_identifier: string | null
}

function buildRows(): Row[] {
  const byDomain = new Map<string, Row>()
  for (const tuple of F2000_US_GAP_FILL_ROWS) {
    const [name, domain, careers_url, industry, size] = tuple
    const d = domain.toLowerCase().trim()
    if (PLACEHOLDER_DOMAINS.has(domain)) continue
    if (!d || d.includes(" ")) continue
    const detected = detectAtsFromUrl(careers_url)
    byDomain.set(d, {
      name,
      domain: d,
      careers_url,
      industry,
      size,
      logo_url: companyLogoUrlFromDomain(d, "google-favicon"),
      ats_type: detected?.atsType ?? null,
      ats_identifier: detected?.atsIdentifier ?? null,
    })
  }
  return [...byDomain.values()]
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("Missing DATABASE_URL in .env.local")
    process.exit(1)
  }

  const seeds = buildRows()
  console.log(`F2000 US gap-fill: ${seeds.length} unique seeds (placeholders dropped, deduped by domain)`)

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  const { rows: existing } = await pool.query<{ domain: string }>(
    "SELECT domain FROM companies WHERE domain = ANY($1::text[])",
    [seeds.map((s) => s.domain)]
  )
  const existingSet = new Set(existing.map((r) => r.domain))
  const toInsert = seeds.filter((s) => !existingSet.has(s.domain))

  console.log(
    `  already in DB (skipping): ${seeds.length - toInsert.length}`
  )
  console.log(`  candidate inserts:        ${toInsert.length}`)

  if (!execute) {
    console.log("\n--- DRY RUN — sample of inserts ---")
    for (const r of toInsert.slice(0, 10)) {
      console.log(
        `  ${r.domain.padEnd(35)} ${r.name.padEnd(40)} ats=${r.ats_type ?? "-"}`
      )
    }
    if (toInsert.length > 10) console.log(`  … and ${toInsert.length - 10} more`)
    console.log("\nDry run only. Re-run with --execute to write to DB.")
    await pool.end()
    return
  }

  let inserted = 0
  for (const r of toInsert) {
    const res = await pool.query(
      `INSERT INTO companies
         (name, domain, careers_url, logo_url, industry, size, ats_type, ats_identifier,
          is_active, sponsors_h1b, sponsorship_confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,false,35)
       ON CONFLICT (domain) DO NOTHING
       RETURNING id`,
      [
        r.name,
        r.domain,
        r.careers_url,
        r.logo_url,
        r.industry,
        r.size,
        r.ats_type,
        r.ats_identifier,
      ]
    )
    if (res.rowCount && res.rowCount > 0) inserted++
  }

  console.log(`\nDone. Inserted ${inserted} new company rows.`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
