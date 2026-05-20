/**
 * One-shot: harvest every USAJOBS-typed company immediately, bypassing the
 * deployed worker (useful when this dev machine has the new adapter code and
 * the production worker doesn't yet).
 *
 * Usage:
 *   npx tsx scripts/harvest-usajobs-now.ts
 *   npx tsx scripts/harvest-usajobs-now.ts --concurrency=2
 *   npx tsx scripts/harvest-usajobs-now.ts --only=VA,DD
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

const concurrency = Math.max(1, Number.parseInt(flag("concurrency") ?? "2", 10))
const onlyArg = flag("only")
const onlyCodes = onlyArg
  ? new Set(onlyArg.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))
  : null

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

async function main() {
  if (!process.env.USAJOBS_API_KEY || !process.env.USAJOBS_USER_AGENT) {
    throw new Error("USAJOBS_API_KEY and USAJOBS_USER_AGENT must be set in .env.local")
  }
  const pool = getPool()
  try {
    const { rows } = await pool.query<{
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
       WHERE ats_type = 'usajobs' AND is_active = true
       ORDER BY name`
    )

    const targets = onlyCodes
      ? rows.filter((r) => r.ats_identifier && onlyCodes.has(r.ats_identifier.toUpperCase()))
      : rows

    console.log(`\n── Harvest USAJOBS now ──────────────────────────────`)
    console.log(`  companies:   ${targets.length}`)
    console.log(`  concurrency: ${concurrency}`)
    if (onlyCodes) console.log(`  only:        ${[...onlyCodes].join(",")}`)
    console.log(`─────────────────────────────────────────────────────\n`)

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
              console.log(`  [no-match]   ${row.name.padEnd(48)} (no adapter)`)
              return
            }
            if (outcome.status === "failed") {
              failed += 1
              console.log(`  [fail]       ${row.name.padEnd(48)} ${outcome.errorMessage}`)
              return
            }
            totalJobs += outcome.jobsFound
            totalNew += outcome.newJobs
            console.log(
              `  [${outcome.status.padEnd(9)}] ${row.name.padEnd(48)} jobs=${outcome.jobsFound.toString().padStart(5)} new=${outcome.newJobs.toString().padStart(5)} (${dt}ms)`
            )
          } catch (err) {
            failed += 1
            console.log(`  [throw]      ${row.name.padEnd(48)} ${err instanceof Error ? err.message : String(err)}`)
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
