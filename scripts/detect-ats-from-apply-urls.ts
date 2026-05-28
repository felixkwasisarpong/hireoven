/**
 * Classify unclassified companies by running detectAdapter() against their
 * existing job apply_urls. Zero HTTP cost — purely uses data already in DB.
 *
 * Strategy:
 *   1. Find companies where ats_type IS NULL but have active jobs with
 *      non-LinkedIn, non-aggregator apply_urls
 *   2. Try detectAdapter() on up to 10 sample apply_urls per company
 *   3. Take the most common detection result as the winner
 *   4. Update company: ats_type, ats_identifier, careers_url, next_harvest_at
 *
 * Usage:
 *   npx tsx scripts/detect-ats-from-apply-urls.ts            # dry-run
 *   npx tsx scripts/detect-ats-from-apply-urls.ts --execute  # write to DB
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import { detectAdapter } from "../lib/harvester/adapters"
import { canonicalCareersUrl } from "../lib/harvester/canonical-url"
import type { AtsName } from "../lib/harvester/adapters"

const args = process.argv.slice(2)
const EXECUTE = args.includes("--execute")

// Domains that are job aggregators — detecting ATS from these gives us the
// aggregator's slug, not the company's own board.
const AGGREGATOR_DOMAINS = new Set([
  "www.linkedin.com",
  "linkedin.com",
  "www.dice.com",
  "dice.com",
  "www.indeed.com",
  "indeed.com",
  "www.glassdoor.com",
  "glassdoor.com",
  "www.monster.com",
  "monster.com",
  "www.ziprecruiter.com",
  "ziprecruiter.com",
  "www.careerbuilder.com",
  "careerbuilder.com",
  "www.simplyhired.com",
  "simplyhired.com",
  "account.ycombinator.com",
  "app.careerpuck.com",
  "wellfound.com",
  "angel.co",
])

function isAggregator(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return AGGREGATOR_DOMAINS.has(hostname.toLowerCase())
  } catch {
    return false
  }
}

type CompanyRow = {
  id: string
  name: string
  careers_url: string
  domain: string | null
}

type ApplyUrlRow = {
  apply_url: string
}

type Detection = {
  ats_type: string
  ats_identifier: string
  careers_url: string
  votes: number
}

async function detectFromApplyUrls(applyUrls: string[]): Promise<Detection | null> {
  const tally = new Map<string, { ats_type: string; ats_identifier: string; votes: number }>()

  for (const url of applyUrls) {
    if (!url || isAggregator(url)) continue
    const result = detectAdapter(url)
    if (!result) continue
    const key = `${result.adapter.name}:${result.slug}`
    const existing = tally.get(key)
    if (existing) {
      existing.votes++
    } else {
      tally.set(key, { ats_type: result.adapter.name, ats_identifier: result.slug, votes: 1 })
    }
  }

  if (tally.size === 0) return null

  // Pick the detection with the most votes
  let best: { ats_type: string; ats_identifier: string; votes: number } | null = null
  for (const entry of tally.values()) {
    if (!best || entry.votes > best.votes) best = entry
  }
  if (!best) return null

  const careers = canonicalCareersUrl(best.ats_type as AtsName, best.ats_identifier)
  if (!careers) return null

  return {
    ats_type: best.ats_type,
    ats_identifier: best.ats_identifier,
    careers_url: careers,
    votes: best.votes,
  }
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

  // Load all unclassified companies that have non-aggregator apply_urls
  const { rows: companies } = await pool.query<CompanyRow>(`
    SELECT DISTINCT c.id, c.name, c.careers_url, c.domain
    FROM companies c
    JOIN jobs j ON j.company_id = c.id
    WHERE c.is_active = true
      AND c.ats_type IS NULL
      AND j.is_active = true
      AND j.apply_url IS NOT NULL
      AND j.apply_url != ''
      AND j.apply_url NOT LIKE '%linkedin%'
      AND j.apply_url NOT LIKE '%dice.com%'
      AND j.apply_url NOT LIKE '%indeed.com%'
      AND j.apply_url NOT LIKE '%glassdoor%'
      AND j.apply_url NOT LIKE '%ziprecruiter%'
    ORDER BY c.name
  `)

  console.log(`Scanning ${companies.length} unclassified companies for ATS via apply_urls...`)

  type PlanRow = { company: CompanyRow; detection: Detection }
  const plan: PlanRow[] = []
  let undetected = 0

  for (const company of companies) {
    // Sample up to 10 distinct apply_urls per company
    const { rows: urlRows } = await pool.query<ApplyUrlRow>(`
      SELECT DISTINCT apply_url
      FROM jobs
      WHERE company_id = $1
        AND is_active = true
        AND apply_url IS NOT NULL
        AND apply_url != ''
        AND apply_url NOT LIKE '%linkedin%'
      LIMIT 10
    `, [company.id])

    const urls = urlRows.map((r) => r.apply_url)
    const detection = await detectFromApplyUrls(urls)

    if (detection) {
      plan.push({ company, detection })
    } else {
      undetected++
    }
  }

  // Summary by ATS type
  const counts: Record<string, number> = {}
  for (const { detection } of plan) {
    counts[detection.ats_type] = (counts[detection.ats_type] ?? 0) + 1
  }

  console.log(`\nDetected: ${plan.length} | Undetected: ${undetected}`)
  console.log("By ATS:", counts)

  if (!EXECUTE) {
    console.log("\n--- DRY RUN (first 20) ---")
    for (const { company, detection } of plan.slice(0, 20)) {
      console.log(
        `  [${detection.ats_type.padEnd(16)}] ${company.name.padEnd(35)} → ${detection.ats_identifier}`
      )
    }
    console.log(`\nRe-run with --execute to write ${plan.length} companies.`)
    await pool.end()
    return
  }

  let updated = 0
  for (const { company, detection } of plan) {
    const res = await pool.query(
      `UPDATE companies
       SET ats_type        = $1,
           ats_identifier  = $2,
           careers_url     = COALESCE(NULLIF(careers_url,''), $3),
           next_harvest_at = NULL
       WHERE id = $4
         AND ats_type IS NULL`,
      [detection.ats_type, detection.ats_identifier, detection.careers_url, company.id]
    )
    if (res.rowCount && res.rowCount > 0) {
      updated++
      console.log(`  Updated: ${company.name} → ${detection.ats_type}:${detection.ats_identifier}`)
    }
  }

  console.log(`\nUpdated ${updated} companies. Harvester will pick them up on the next cycle.`)
  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
