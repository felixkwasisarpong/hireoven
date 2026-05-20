/**
 * One-shot: harvest every active company that has never been crawled
 * (last_crawled_at IS NULL) or hasn't been crawled in the last 7 days,
 * using the local harvester code. Useful after a seed run when the
 * production worker doesn't have the new adapter code/env vars yet.
 *
 * Usage:
 *   npx tsx scripts/harvest-uncrawled-now.ts                  # all uncrawled
 *   npx tsx scripts/harvest-uncrawled-now.ts --since-min=30   # also stale >30 min
 *   npx tsx scripts/harvest-uncrawled-now.ts --concurrency=4
 *   npx tsx scripts/harvest-uncrawled-now.ts --ats=workday    # filter
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import { runAtsHarvest, type AtsHarvestCompany } from "@/lib/harvester/run-harvest"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const concurrency = Math.max(1, Number.parseInt(flag("concurrency") ?? "3", 10))
const sinceMin = Number.parseInt(flag("since-min") ?? "", 10)
const atsFilter = flag("ats")?.toLowerCase() ?? null
const limit = Number.parseInt(flag("limit") ?? "", 10)
const limitClause = Number.isFinite(limit) && limit > 0 ? `LIMIT ${limit}` : ""

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

async function main() {
  const pool = getPool()
  try {
    const where = [
      "is_active = true",
      "ats_type IS NOT NULL",
    ]
    if (Number.isFinite(sinceMin) && sinceMin > 0) {
      where.push(
        `(last_crawled_at IS NULL OR last_crawled_at < now() - interval '${sinceMin} minutes')`
      )
    } else {
      where.push("last_crawled_at IS NULL")
    }
    const params: unknown[] = []
    if (atsFilter) {
      params.push(atsFilter)
      where.push(`ats_type = $${params.length}`)
    }

    const { rows: targets } = await pool.query<{
      id: string
      name: string
      careers_url: string
      direct_ats_url: string | null
      domain: string | null
      ats_type: string | null
      ats_identifier: string | null
      raw_ats_config: Record<string, unknown> | null
      etag: string | null
      last_modified: string | null
      freshness_tier: string | null
    }>(
      `SELECT id, name, careers_url, direct_ats_url, domain, ats_type, ats_identifier,
              raw_ats_config, etag, last_modified, freshness_tier
       FROM companies
       WHERE ${where.join("\n         AND ")}
       ORDER BY ats_type, name
       ${limitClause}`,
      params
    )

    console.log(`\n── Harvest uncrawled-now ────────────────────────────`)
    console.log(`  companies:   ${targets.length}`)
    console.log(`  concurrency: ${concurrency}`)
    if (atsFilter) console.log(`  ats filter:  ${atsFilter}`)
    if (sinceMin > 0) console.log(`  stale > min: ${sinceMin}`)
    console.log(`─────────────────────────────────────────────────────\n`)

    if (targets.length === 0) {
      console.log("Nothing to harvest. Exiting.\n")
      return
    }

    const limiter = pLimit(concurrency)
    let totalJobs = 0
    let totalNew = 0
    let failed = 0

    await Promise.all(
      targets.map((row) =>
        limiter(async () => {
          const company: AtsHarvestCompany = {
            id: row.id,
            name: row.name,
            careers_url: row.careers_url,
            direct_ats_url: row.direct_ats_url,
            domain: row.domain,
            ats_type: row.ats_type,
            ats_identifier: row.ats_identifier,
            raw_ats_config: row.raw_ats_config,
            etag: row.etag,
            last_modified: row.last_modified,
            freshness_tier: row.freshness_tier,
          }
          const t0 = Date.now()
          try {
            const outcome = await runAtsHarvest({ pool, company })
            const dt = Date.now() - t0
            if (!outcome.matched) {
              console.log(`  [no-match]   ${row.name.slice(0, 36).padEnd(36)} ${row.ats_type}`)
              return
            }
            if (outcome.status === "failed") {
              failed += 1
              console.log(
                `  [fail]       ${row.name.slice(0, 36).padEnd(36)} ${row.ats_type} ${outcome.errorMessage}`
              )
              return
            }
            totalJobs += outcome.jobsFound
            totalNew += outcome.newJobs
            console.log(
              `  [${outcome.status.padEnd(9)}] ${row.name.slice(0, 36).padEnd(36)} ${(row.ats_type ?? "?").padEnd(16)} jobs=${outcome.jobsFound.toString().padStart(5)} new=${outcome.newJobs.toString().padStart(5)} (${dt}ms)`
            )
          } catch (err) {
            failed += 1
            console.log(
              `  [throw]      ${row.name.slice(0, 36).padEnd(36)} ${row.ats_type} ${err instanceof Error ? err.message : String(err)}`
            )
          }
        })
      )
    )

    console.log(`\nSummary: totalJobs=${totalJobs} newJobs=${totalNew} failed=${failed}\n`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
