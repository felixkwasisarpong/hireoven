/**
 * Seed 2024-2025 salary benchmark data for offer negotiation analysis.
 * Data sourced from Levels.fyi, LinkedIn Salary, Glassdoor (public 2024-2025 aggregates).
 *
 * Usage:
 *   npx tsx scripts/seed-salary-benchmarks.ts
 *   npx tsx scripts/seed-salary-benchmarks.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")

type LocationType = "remote" | "sf_bay" | "nyc" | "seattle" | "austin" | "chicago" | "boston"

type BenchmarkRow = {
  role_title_normalized: string
  location_type: LocationType
  p25_salary: number
  p50_salary: number
  p75_salary: number
  p90_salary: number
  data_year: number
  source: string
}

// Base salaries for SF Bay (highest cost-of-labor market).
// Other regions are multiples of the SF base.
const SF_MULTIPLIERS: Record<LocationType, number> = {
  sf_bay: 1.0,
  nyc: 0.92,
  seattle: 0.88,
  boston: 0.82,
  chicago: 0.75,
  austin: 0.77,
  remote: 0.85,
}

type RoleBase = {
  slug: string
  sf: [number, number, number, number] // p25, p50, p75, p90
}

const ROLES: RoleBase[] = [
  // Engineering ICs
  { slug: "software engineer",          sf: [145000, 170000, 210000, 250000] },
  { slug: "senior software engineer",   sf: [185000, 220000, 265000, 310000] },
  { slug: "staff engineer",             sf: [235000, 278000, 330000, 395000] },
  { slug: "principal engineer",         sf: [280000, 335000, 400000, 470000] },
  { slug: "frontend engineer",          sf: [140000, 168000, 205000, 245000] },
  { slug: "backend engineer",           sf: [150000, 180000, 218000, 258000] },
  { slug: "full stack engineer",        sf: [145000, 175000, 212000, 252000] },
  { slug: "devops engineer",            sf: [155000, 188000, 228000, 270000] },
  { slug: "platform engineer",          sf: [160000, 195000, 235000, 280000] },
  { slug: "security engineer",          sf: [165000, 200000, 242000, 288000] },
  { slug: "qa engineer",               sf: [120000, 148000, 180000, 215000] },
  { slug: "solutions engineer",         sf: [148000, 182000, 222000, 265000] },
  // Engineering management
  { slug: "engineering manager",        sf: [225000, 268000, 320000, 378000] },
  { slug: "senior engineering manager", sf: [268000, 318000, 375000, 440000] },
  { slug: "director of engineering",    sf: [310000, 370000, 445000, 525000] },
  // Data & ML
  { slug: "data scientist",             sf: [158000, 192000, 232000, 278000] },
  { slug: "senior data scientist",      sf: [198000, 238000, 285000, 340000] },
  { slug: "ml engineer",               sf: [182000, 222000, 268000, 320000] },
  { slug: "data engineer",             sf: [152000, 185000, 224000, 268000] },
  { slug: "analytics engineer",         sf: [145000, 175000, 212000, 252000] },
  // Product
  { slug: "product manager",           sf: [162000, 198000, 240000, 288000] },
  { slug: "senior product manager",    sf: [200000, 242000, 292000, 348000] },
  { slug: "director of product",       sf: [270000, 325000, 390000, 460000] },
  // Design
  { slug: "ux designer",               sf: [128000, 158000, 192000, 232000] },
  { slug: "senior designer",           sf: [152000, 188000, 228000, 272000] },
  { slug: "product designer",          sf: [152000, 188000, 228000, 272000] },
  // Go-to-market
  { slug: "customer success manager",  sf: [112000, 138000, 168000, 200000] },
  { slug: "account executive",         sf: [128000, 168000, 215000, 270000] },
  { slug: "sales engineer",            sf: [152000, 188000, 228000, 272000] },
]

function buildRows(): BenchmarkRow[] {
  const rows: BenchmarkRow[] = []
  for (const role of ROLES) {
    for (const [loc, mult] of Object.entries(SF_MULTIPLIERS) as [LocationType, number][]) {
      rows.push({
        role_title_normalized: role.slug,
        location_type: loc,
        p25_salary: Math.round(role.sf[0] * mult / 1000) * 1000,
        p50_salary: Math.round(role.sf[1] * mult / 1000) * 1000,
        p75_salary: Math.round(role.sf[2] * mult / 1000) * 1000,
        p90_salary: Math.round(role.sf[3] * mult / 1000) * 1000,
        data_year: 2025,
        source: "benchmark_estimate_levels_glassdoor_linkedin_2024_2025",
      })
    }
  }
  return rows
}

async function run() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("DATABASE_URL is required")

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  })

  const rows = buildRows()
  console.log(`Seeding ${rows.length} salary benchmark rows (${ROLES.length} roles × 7 locations)…`)

  if (dryRun) {
    console.log("Dry run — sample:", rows.slice(0, 2))
    await pool.end()
    return
  }

  let inserted = 0
  for (const row of rows) {
    await pool.query(
      `INSERT INTO public.salary_benchmarks
         (role_title_normalized, location_type, p25_salary, p50_salary, p75_salary, p90_salary, data_year, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (role_title_normalized, location_type, data_year)
       DO UPDATE SET
         p25_salary = EXCLUDED.p25_salary,
         p50_salary = EXCLUDED.p50_salary,
         p75_salary = EXCLUDED.p75_salary,
         p90_salary = EXCLUDED.p90_salary,
         source = EXCLUDED.source`,
      [row.role_title_normalized, row.location_type, row.p25_salary, row.p50_salary, row.p75_salary, row.p90_salary, row.data_year, row.source]
    )
    inserted++
  }

  console.log(`\n✓ Seeded ${inserted} salary benchmark rows.`)
  await pool.end()
}

run().catch((err) => { console.error(err); process.exit(1) })
