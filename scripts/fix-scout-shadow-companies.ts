/**
 * The one Career Site Scout shadow record that must NOT be merged.
 *
 * The scout created a second company row for employers it already tracked, named
 * from the ATS identifier or the page <title> and carrying a synthetic domain so
 * no logo could resolve. Five of the six were the same employer as an existing
 * record and were merged with scripts/merge-duplicate-ats-companies.ts:
 *
 *   Conocophillips:Wd1:External  -> ConocoPhillips        (canonical key grouping)
 *   Bakerhughes                  -> Baker Hughes          (--ids)
 *   Enbridge                     -> Enbridge              (--ids, 3 rows)
 *   Global Payments  |           -> Global Payments       (--ids)
 *   Metropolis                   -> Metropolis Technologies (--ids)
 *
 * The sixth is not a duplicate at all. Its careers_url is
 * https://jobs.deel.com/klarna — Klarna's board hosted on Deel's job-board
 * product. The name "Make your next move matter" is Deel's page tagline, scraped
 * by the old title-based naming. Merging it into Deel on the strength of the
 * `jobs.deel.com` host would fuse two unrelated employers, which is the failure
 * that stranded U.S. Bank behind Elavon.
 *
 * It holds no jobs, so there is nothing to move. This renames it off the tagline,
 * leaves it dormant, and records why, so the next person to see it reassigns it to
 * Klarna rather than merging it into Deel.
 *
 * Usage:
 *   npx tsx scripts/fix-scout-shadow-companies.ts             # dry run
 *   npx tsx scripts/fix-scout-shadow-companies.ts --execute
 */

import { loadEnvConfig } from "@next/env"

loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

const execute = process.argv.includes("--execute")

const KLARNA_ON_DEEL = "618e6d9e-81d7-4835-9deb-5ddda0d4b79a"
const NOTE =
  "Career Site Scout recorded https://jobs.deel.com/klarna — Klarna's board hosted on Deel's product, not Deel's own. " +
  "Do NOT merge into Deel; reassign to Klarna if that employer is tracked."

async function main() {
  const pool = getPostgresPool()

  const { rows } = await pool.query<{
    name: string
    careers_url: string | null
    active_jobs: string
  }>(
    `SELECT name, careers_url,
            (SELECT count(*) FROM jobs WHERE company_id = c.id AND is_active)::text AS active_jobs
       FROM companies c WHERE id = $1`,
    [KLARNA_ON_DEEL]
  )
  const row = rows[0]
  if (!row) {
    console.log("row not found — nothing to do")
    await pool.end()
    return
  }

  console.log(`[fix-scout-shadows] mode=${execute ? "EXECUTE" : "dry-run"}`)
  console.log(`  name        ${row.name}`)
  console.log(`  careers_url ${row.careers_url}`)
  console.log(`  active jobs ${row.active_jobs}`)

  // Guard: only safe because the row carries no jobs. If a later crawl attached
  // some, they are Klarna's and moving them anywhere needs a decision first.
  if (Number(row.active_jobs) > 0) {
    console.log("\n  !! row now holds active jobs — refusing to touch it, reassign to Klarna deliberately")
    await pool.end()
    process.exitCode = 1
    return
  }

  console.log(`\n  -> rename to "Klarna (via Deel job board)", keep dormant, record the note`)

  if (execute) {
    await pool.query(
      `UPDATE companies
          SET name = 'Klarna (via Deel job board)',
              is_active = false,
              status = 'unknown',
              next_harvest_at = NULL,
              notes = $2,
              updated_at = now()
        WHERE id = $1`,
      [KLARNA_ON_DEEL, NOTE]
    )
    console.log("  done")
  } else {
    console.log("\n(Pass --execute to apply.)")
  }

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
