/**
 * Deactivates active jobs whose location is outside our supported regions
 * (Remote / United States / Canada). Uses the same predicate as the live
 * crawler persist layer so future crawls and the cleanup stay in sync.
 *
 * Usage:
 *   npx tsx scripts/deactivate-out-of-region-jobs.ts            # dry-run
 *   npx tsx scripts/deactivate-out-of-region-jobs.ts --execute  # write
 *   npx tsx scripts/deactivate-out-of-region-jobs.ts --execute --batch=1000
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { isExplicitlyForeign } from "@/lib/jobs/location-filter"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const batchArg = process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1]
const batchSize = Math.max(1, Number.parseInt(batchArg ?? "500", 10))

function getPool() {
  const conn = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!conn) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString: conn,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

type JobRow = {
  id: string
  title: string
  location: string | null
  is_remote: boolean | null
}

async function main() {
  const pool = getPool()
  console.log(`[cleanup] mode=${execute ? "EXECUTE" : "DRY-RUN"} batch=${batchSize}`)

  let scanned = 0
  const toDeactivate: JobRow[] = []
  let cursor: string | null = null

  // Stream through active jobs in id order so we can checkpoint by cursor.
  while (true) {
    const sql: string = cursor
      ? `SELECT id, title, location, is_remote FROM jobs WHERE is_active = true AND id > $2 ORDER BY id LIMIT $1`
      : `SELECT id, title, location, is_remote FROM jobs WHERE is_active = true ORDER BY id LIMIT $1`
    const params: Array<string | number> = cursor ? [batchSize, cursor] : [batchSize]
    const res = await pool.query<JobRow>(sql, params)

    if (res.rows.length === 0) break

    for (const row of res.rows) {
      scanned += 1
      // Exclude only explicit foreign locations. Generic remote jobs with no
      // country signal remain active and can still be US/CA eligible.
      if (isExplicitlyForeign({ location: row.location })) {
        toDeactivate.push(row)
      }
    }

    cursor = res.rows[res.rows.length - 1]!.id

    if (scanned % 5000 === 0) {
      process.stderr.write(`  scanned=${scanned} flagged=${toDeactivate.length}\r`)
    }
  }

  process.stderr.write("\n")
  console.log(`Scanned: ${scanned} active jobs`)
  console.log(`To deactivate: ${toDeactivate.length}`)

  if (toDeactivate.length > 0) {
    console.log("\nSample (up to 10):")
    for (const row of toDeactivate.slice(0, 10)) {
      console.log(
        `  ${row.title.slice(0, 50).padEnd(50)} | loc=${row.location ?? "(null)"} | remote=${row.is_remote ?? "?"}`
      )
    }
  }

  if (!execute) {
    console.log("\nDry-run complete. Re-run with --execute to deactivate.")
    await pool.end()
    return
  }

  // Deactivate in chunks so we don't ship a 100k-element array param.
  const ids = toDeactivate.map((r) => r.id)
  const CHUNK = 1000
  let updated = 0
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK)
    const r = await pool.query(
      `UPDATE jobs SET is_active = false, updated_at = now() WHERE id = ANY($1::uuid[])`,
      [slice]
    )
    updated += r.rowCount ?? 0
    process.stderr.write(`  updated ${updated}/${ids.length}\r`)
  }
  process.stderr.write("\n")
  console.log(`Deactivated: ${updated} jobs`)
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
