/**
 * Remove inactive company rows whose names contain "university" or "college".
 *
 * Safe flow:
 * 1) Export backup CSV of target rows
 * 2) Unlink target company IDs from H1B/LCA tables
 * 3) Delete target company rows
 *
 * Usage:
 *   npx tsx scripts/remove-inactive-university-college-companies.ts
 *   npx tsx scripts/remove-inactive-university-college-companies.ts --execute
 *   npx tsx scripts/remove-inactive-university-college-companies.ts --execute --out=scripts/output/backup.csv
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, "\"\"")}"`
}

const execute = process.argv.includes("--execute")
const outPath =
  flag("out") ??
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `inactive-university-college-companies-backup-${new Date().toISOString().slice(0, 10)}.csv`
  )

const TARGET_SQL = `
  SELECT
    id,
    name,
    domain,
    is_active,
    ats_type,
    careers_url,
    COALESCE(job_count, 0) AS job_count,
    last_crawled_at,
    created_at,
    updated_at
  FROM companies
  WHERE is_active = false
    AND name ~* '(university|college)'
  ORDER BY name ASC
`

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const { rows: targets } = await pool.query(TARGET_SQL)
    const ids = targets.map((r) => String((r as Record<string, unknown>).id))

    const [{ rows: relationRows }, { rows: postRows }] = await Promise.all([
      pool.query(
        `WITH target AS (
           SELECT id
           FROM companies
           WHERE is_active = false
             AND name ~* '(university|college)'
         )
         SELECT
           (SELECT COUNT(*)::int FROM target) AS target_companies,
           (SELECT COUNT(*)::int FROM jobs j JOIN target t ON t.id = j.company_id) AS jobs_linked,
           (SELECT COUNT(*)::int FROM lca_records l JOIN target t ON t.id = l.company_id) AS lca_linked,
           (SELECT COUNT(*)::int FROM employer_lca_stats e JOIN target t ON t.id = e.company_id) AS employer_stats_linked,
           (SELECT COUNT(*)::int FROM h1b_records h JOIN target t ON t.id = h.company_id) AS h1b_linked`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS remaining_matching
         FROM companies
         WHERE is_active = false
           AND name ~* '(university|college)'`
      ),
    ])

    const relation = relationRows[0] as Record<string, number>
    const remainingBefore = Number((postRows[0] as Record<string, unknown>).remaining_matching ?? 0)

    const header = [
      "id",
      "name",
      "domain",
      "is_active",
      "ats_type",
      "careers_url",
      "job_count",
      "last_crawled_at",
      "created_at",
      "updated_at",
    ]
    const lines = [header.map(csvEscape).join(",")]
    for (const row of targets) {
      lines.push(
        header.map((k) => csvEscape((row as Record<string, unknown>)[k])).join(",")
      )
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, lines.join("\n"))

    console.log(`[remove] backup_csv=${outPath}`)
    console.log(
      `[remove] targets=${remainingBefore} jobs_linked=${relation.jobs_linked} lca_linked=${relation.lca_linked} employer_stats_linked=${relation.employer_stats_linked} h1b_linked=${relation.h1b_linked}`
    )

    if (!execute) {
      console.log("[remove] dry-run complete. Re-run with --execute to delete.")
      return
    }

    if (ids.length === 0) {
      console.log("[remove] nothing to delete.")
      return
    }

    await pool.query("BEGIN")
    try {
      const lcaRes = await pool.query(
        `UPDATE lca_records
            SET company_id = NULL
          WHERE company_id = ANY($1::uuid[])`,
        [ids]
      )
      const statsRes = await pool.query(
        `UPDATE employer_lca_stats
            SET company_id = NULL
          WHERE company_id = ANY($1::uuid[])`,
        [ids]
      )
      const h1bRes = await pool.query(
        `UPDATE h1b_records
            SET company_id = NULL
          WHERE company_id = ANY($1::uuid[])`,
        [ids]
      )
      const delRes = await pool.query(
        `DELETE FROM companies
          WHERE id = ANY($1::uuid[])`,
        [ids]
      )
      await pool.query("COMMIT")

      const { rows: afterRows } = await pool.query(
        `SELECT COUNT(*)::int AS remaining_matching
         FROM companies
         WHERE is_active = false
           AND name ~* '(university|college)'`
      )
      const remainingAfter = Number(
        (afterRows[0] as Record<string, unknown>).remaining_matching ?? 0
      )

      console.log(
        `[remove] deleted=${delRes.rowCount ?? 0} lca_unlinked=${lcaRes.rowCount ?? 0} employer_stats_unlinked=${statsRes.rowCount ?? 0} h1b_unlinked=${h1bRes.rowCount ?? 0} remaining=${remainingAfter}`
      )
    } catch (error) {
      await pool.query("ROLLBACK")
      throw error
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

