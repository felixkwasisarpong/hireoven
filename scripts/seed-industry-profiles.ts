/**
 * Seed background check profiles for 8 industry verticals.
 *
 * Usage:
 *   npx tsx scripts/seed-industry-profiles.ts
 *   npx tsx scripts/seed-industry-profiles.ts --dry-run
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

const dryRun = process.argv.includes("--dry-run")

type IndustryRow = {
  industry_slug: string
  industry_label: string
  material_icon: string
  typical_lookback_years: number | null
  runs_credit_check: boolean
  runs_federal_check: boolean
  fdic_applicable: boolean
  oig_applicable: boolean
  security_clearance_possible: boolean
  conviction_risk_level: "low" | "medium" | "high"
  credit_risk_level: "low" | "medium" | "high"
  gap_risk_level: "low" | "medium" | "high"
  notes: string
}

const INDUSTRIES: IndustryRow[] = [
  {
    industry_slug: "tech",
    industry_label: "Technology",
    material_icon: "devices",
    typical_lookback_years: 7,
    runs_credit_check: false,
    runs_federal_check: false,
    fdic_applicable: false,
    oig_applicable: false,
    security_clearance_possible: false,
    conviction_risk_level: "low",
    credit_risk_level: "low",
    gap_risk_level: "low",
    notes:
      "Most tech companies use standard 7-year background checks covering criminal history and employment verification. Startups under Series A often do minimal or no background checks. Financial-adjacent tech roles (fintech, crypto) may add credit checks. Remote-first companies in ban-the-box states must follow those state rules even for fully remote hires.",
  },
  {
    industry_slug: "finance",
    industry_label: "Finance / Banking",
    material_icon: "account_balance",
    typical_lookback_years: null,
    runs_credit_check: true,
    runs_federal_check: true,
    fdic_applicable: true,
    oig_applicable: false,
    security_clearance_possible: false,
    conviction_risk_level: "high",
    credit_risk_level: "high",
    gap_risk_level: "medium",
    notes:
      "FDIC Section 19 bars individuals with certain convictions from working at FDIC-insured institutions without a waiver. This includes convictions involving dishonesty, breach of trust, or money laundering — no lookback limit applies. Credit checks are standard for most finance roles. Investment advisors must pass FINRA checks. Waivers under FDIC Section 19 are possible but require application and are not guaranteed.",
  },
  {
    industry_slug: "healthcare",
    industry_label: "Healthcare",
    material_icon: "local_hospital",
    typical_lookback_years: null,
    runs_credit_check: false,
    runs_federal_check: true,
    fdic_applicable: false,
    oig_applicable: true,
    security_clearance_possible: false,
    conviction_risk_level: "high",
    credit_risk_level: "low",
    gap_risk_level: "low",
    notes:
      "OIG exclusion list check is mandatory for all roles billing federal healthcare programs (Medicare/Medicaid). Convictions related to healthcare fraud, patient abuse, controlled substance violations, or crimes of moral turpitude are typically disqualifying without limit. Many states require fingerprinting for clinical roles. Non-clinical healthcare roles (IT, admin, billing) generally use standard 7-year checks.",
  },
  {
    industry_slug: "retail",
    industry_label: "Retail / E-commerce",
    material_icon: "storefront",
    typical_lookback_years: 7,
    runs_credit_check: false,
    runs_federal_check: false,
    fdic_applicable: false,
    oig_applicable: false,
    security_clearance_possible: false,
    conviction_risk_level: "low",
    credit_risk_level: "low",
    gap_risk_level: "low",
    notes:
      "Standard 7-year criminal history checks are the norm. Fair chance hiring is widely practiced among major retailers — Amazon, Target, and Walmart all have public fair chance commitments. Most retail roles focus on theft and violent crime convictions; drug offenses are increasingly overlooked. E-commerce corporate roles may have stricter screening than in-store positions.",
  },
  {
    industry_slug: "logistics",
    industry_label: "Logistics / Warehouse",
    material_icon: "local_shipping",
    typical_lookback_years: 7,
    runs_credit_check: false,
    runs_federal_check: false,
    fdic_applicable: false,
    oig_applicable: false,
    security_clearance_possible: false,
    conviction_risk_level: "medium",
    credit_risk_level: "low",
    gap_risk_level: "low",
    notes:
      "Non-driving warehouse and fulfillment roles use standard 7-year checks and are generally accessible. DOT-regulated commercial driving roles (CDL) require additional Motor Vehicle Record (MVR) checks and DUI convictions can be disqualifying. FMCSA drug and alcohol testing is mandatory for CDL drivers. Amazon and major 3PLs have active second-chance hiring programs.",
  },
  {
    industry_slug: "government",
    industry_label: "Government",
    material_icon: "domain",
    typical_lookback_years: null,
    runs_credit_check: true,
    runs_federal_check: true,
    fdic_applicable: false,
    oig_applicable: false,
    security_clearance_possible: true,
    conviction_risk_level: "high",
    credit_risk_level: "high",
    gap_risk_level: "medium",
    notes:
      "Federal roles require full background investigation (BI) with no lookback limit. Security clearances (Secret, Top Secret, TS/SCI) require extensive personal history review including financial, foreign contacts, and character. State and local government vary widely — many are covered by local ban-the-box ordinances but some roles (law enforcement, education) are explicitly excluded. Credit history is reviewed for clearance-eligible roles.",
  },
  {
    industry_slug: "startup",
    industry_label: "Startup",
    material_icon: "rocket_launch",
    typical_lookback_years: 7,
    runs_credit_check: false,
    runs_federal_check: false,
    fdic_applicable: false,
    oig_applicable: false,
    security_clearance_possible: false,
    conviction_risk_level: "low",
    credit_risk_level: "low",
    gap_risk_level: "low",
    notes:
      "Early-stage startups (under 50 employees) frequently skip background checks or run minimal checks. Seed/Series A companies often use lightweight services like Checkr's basic package. Series B and beyond typically adopt standard 7-year checks especially after VC pressure or enterprise sales requirements. Fintech and healthcare startups are exceptions — they adopt stricter checks from day one due to regulatory exposure.",
  },
  {
    industry_slug: "education",
    industry_label: "Education",
    material_icon: "school",
    typical_lookback_years: null,
    runs_credit_check: false,
    runs_federal_check: true,
    fdic_applicable: false,
    oig_applicable: false,
    security_clearance_possible: false,
    conviction_risk_level: "high",
    credit_risk_level: "low",
    gap_risk_level: "low",
    notes:
      "Most education roles involving direct contact with minors require FBI fingerprint checks (via FBI Rap Back) with no lookback limit. Sex offenses, violent crimes, and crimes against children are permanently disqualifying. Many states have specific educator background check laws. Non-instructional roles (admin, IT, facilities) generally use standard 7-year checks. Higher education roles have more variability.",
  },
]

async function run() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("DATABASE_URL is required")

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  })

  console.log(`Seeding ${INDUSTRIES.length} industry profiles...`)

  if (dryRun) {
    console.log("Dry run — would insert:", INDUSTRIES.map((i) => i.industry_slug).join(", "))
    await pool.end()
    return
  }

  for (const ind of INDUSTRIES) {
    await pool.query(
      `INSERT INTO public.industry_check_profiles (
        industry_slug, industry_label, material_icon, typical_lookback_years,
        runs_credit_check, runs_federal_check, fdic_applicable, oig_applicable,
        security_clearance_possible, conviction_risk_level, credit_risk_level,
        gap_risk_level, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (industry_slug) DO UPDATE SET
        industry_label = EXCLUDED.industry_label,
        material_icon = EXCLUDED.material_icon,
        typical_lookback_years = EXCLUDED.typical_lookback_years,
        runs_credit_check = EXCLUDED.runs_credit_check,
        runs_federal_check = EXCLUDED.runs_federal_check,
        fdic_applicable = EXCLUDED.fdic_applicable,
        oig_applicable = EXCLUDED.oig_applicable,
        security_clearance_possible = EXCLUDED.security_clearance_possible,
        conviction_risk_level = EXCLUDED.conviction_risk_level,
        credit_risk_level = EXCLUDED.credit_risk_level,
        gap_risk_level = EXCLUDED.gap_risk_level,
        notes = EXCLUDED.notes`,
      [
        ind.industry_slug, ind.industry_label, ind.material_icon,
        ind.typical_lookback_years, ind.runs_credit_check, ind.runs_federal_check,
        ind.fdic_applicable, ind.oig_applicable, ind.security_clearance_possible,
        ind.conviction_risk_level, ind.credit_risk_level, ind.gap_risk_level,
        ind.notes,
      ]
    )
    console.log(`  ✓ ${ind.industry_slug} — ${ind.industry_label}`)
  }

  console.log(`\nSeeded ${INDUSTRIES.length} industry profiles successfully.`)
  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
