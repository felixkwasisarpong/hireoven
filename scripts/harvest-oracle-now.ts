/**
 * One-shot local harvest of all Oracle Cloud HCM companies using the updated
 * adapter (with ShortDescriptionStr fallback). Run this to backfill descriptions
 * without waiting for the remote worker to restart.
 *
 * Usage: npx tsx scripts/harvest-oracle-now.ts
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { Pool } from "pg"
import pLimit from "p-limit"
import { runAtsHarvest } from "../lib/harvester/run-harvest"

const CONCURRENCY = 4

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! })

  const { rows: companies } = await pool.query(`
    SELECT id, name, careers_url, direct_ats_url, domain,
           ats_type, ats_identifier, raw_ats_config, etag, last_modified, freshness_tier
    FROM companies
    WHERE ats_type = 'oraclecloud'
      AND is_active = true
      AND ats_identifier IS NOT NULL
    ORDER BY name
  `)

  console.log(`Harvesting ${companies.length} Oracle companies with new description support...`)

  const limiter = pLimit(CONCURRENCY)
  let success = 0, failed = 0, unchanged = 0

  await Promise.all(
    companies.map((company) =>
      limiter(async () => {
        const outcome = await runAtsHarvest({ pool, company })
        if (!outcome.matched) {
          console.warn(`  MISMATCH: ${company.name} (${company.ats_identifier})`)
          failed++
          return
        }
        if (outcome.status === "success") {
          success++
          console.log(`  ✓ ${company.name.padEnd(35)} jobs=${outcome.jobsFound} new=${outcome.newJobs} ${outcome.durationMs}ms`)
        } else if (outcome.status === "unchanged") {
          unchanged++
        } else {
          failed++
          console.warn(`  ✗ ${company.name}: ${outcome.errorMessage?.slice(0, 100)}`)
        }
      })
    )
  )

  console.log(`\nDone: ${success} success, ${unchanged} unchanged, ${failed} failed`)

  // Check description coverage after harvest
  const { rows: coverage } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE length(COALESCE(description,'')) > 50) as with_desc,
      COUNT(*) as total
    FROM jobs j
    JOIN companies c ON c.id = j.company_id
    WHERE c.ats_type = 'oraclecloud'
      AND j.source_ats = 'oraclecloud'
      AND j.is_active = true
  `)
  const row = coverage[0]
  const pct = Math.round(100 * parseInt(row.with_desc) / parseInt(row.total))
  console.log(`\nOracle job description coverage: ${row.with_desc}/${row.total} (${pct}%)`)

  await pool.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
