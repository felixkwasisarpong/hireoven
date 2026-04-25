/**
 * Upserts the 45-category company expansion list into Postgres.
 *
 * Usage:
 *   npx tsx scripts/seed-companies-expansion.ts
 *   npx tsx scripts/seed-companies-expansion.ts --dry-run
 *
 * Requires: DATABASE_URL in .env.local
 * Upserts on domain — existing rows are skipped/updated, new rows inserted.
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { companyLogoUrlFromDomain } from "../lib/companies/logo-url"
import { EXPANSION_SEED_ROWS } from "./data/company-seeds-expansion"
import type { CompanySize, SeedExtra } from "./data/company-seeds"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")
const BATCH = 50

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
  const e: SeedExtra = row.length > 5 ? (row[5] as SeedExtra) : {}
  const sponsors = e.sponsors_h1b ?? false
  return {
    name: row[0],
    domain: row[1].toLowerCase(),
    careers_url: row[2],
    industry: row[3],
    size: row[4],
    logo_url: companyLogoUrlFromDomain(row[1], "google-favicon"),
    ats_type: e.ats_type ?? null,
    ats_identifier: e.ats_identifier ?? null,
    is_active: true,
    sponsors_h1b: sponsors,
    sponsorship_confidence:
      typeof e.sponsorship_confidence === "number" ? e.sponsorship_confidence : sponsors ? 65 : 35,
  }
}

function dedupeByDomain(rows: InsertRow[]): InsertRow[] {
  const map = new Map<string, InsertRow>()
  for (const r of rows) map.set(r.domain, r)
  return [...map.values()]
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) {
    console.error("Missing DATABASE_URL (or TARGET_POSTGRES_URL) in .env.local")
    process.exit(1)
  }

  const rows = dedupeByDomain(EXPANSION_SEED_ROWS.map(rowFromTuple))
  console.log(`\nExpansion: ${rows.length} unique companies to upsert\n`)

  if (dryRun) {
    console.log("--- DRY RUN (first 5) ---")
    rows.slice(0, 5).forEach((r) => console.log(`  ${r.domain.padEnd(35)} ${r.name}`))
    console.log(`  … and ${rows.length - 5} more`)
    return
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  })

  const { rows: [{ count: before }] } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM companies"
  )

  let inserted = 0
  let updated = 0

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)

    for (const r of chunk) {
      const { rowCount } = await pool.query(
        `INSERT INTO companies
           (name, domain, careers_url, logo_url, industry, size, ats_type, ats_identifier,
            is_active, sponsors_h1b, sponsorship_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (domain) DO UPDATE SET
           name                   = EXCLUDED.name,
           careers_url            = EXCLUDED.careers_url,
           logo_url               = COALESCE(companies.logo_url, EXCLUDED.logo_url),
           industry               = COALESCE(companies.industry, EXCLUDED.industry),
           size                   = COALESCE(companies.size, EXCLUDED.size),
           sponsors_h1b           = EXCLUDED.sponsors_h1b,
           sponsorship_confidence = EXCLUDED.sponsorship_confidence,
           is_active              = true
         RETURNING (xmax = 0) AS was_inserted`,
        [
          r.name, r.domain, r.careers_url, r.logo_url, r.industry, r.size,
          r.ats_type, r.ats_identifier, r.is_active, r.sponsors_h1b, r.sponsorship_confidence,
        ]
      )
      // xmax=0 means it was a fresh INSERT; otherwise it was an UPDATE
      if (rowCount && rowCount > 0) inserted++
      else updated++
    }

    process.stdout.write(`\r  Processed ${Math.min(i + BATCH, rows.length)} / ${rows.length}`)
  }

  const { rows: [{ count: after }] } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM companies"
  )

  await pool.end()

  console.log(`\n\n✓ Done`)
  console.log(`  Newly inserted    : ${Number(after) - Number(before)}`)
  console.log(`  Updated (existing): ${rows.length - (Number(after) - Number(before))}`)
  console.log(`  Total in DB now   : ${after}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
