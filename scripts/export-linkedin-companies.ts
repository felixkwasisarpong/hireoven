/**
 * Export company rows whose careers_url points to LinkedIn into CSV.
 *
 * Usage:
 *   npx tsx scripts/export-linkedin-companies.ts
 *   npx tsx scripts/export-linkedin-companies.ts --inactive-only
 *   npx tsx scripts/export-linkedin-companies.ts --placeholder-only
 *   npx tsx scripts/export-linkedin-companies.ts --out=scripts/output/my-file.csv
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

const inactiveOnly = process.argv.includes("--inactive-only")
const placeholderOnly = process.argv.includes("--placeholder-only")
const outPath =
  flag("out") ??
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `linkedin-companies-${new Date().toISOString().slice(0, 10)}.csv`
  )

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  try {
    const where: string[] = [`careers_url ILIKE '%linkedin.com%'`]
    if (inactiveOnly) where.push(`is_active = false`)
    if (placeholderOnly) {
      where.push(`(domain ILIKE '%.lca-employer' OR domain ILIKE '%.uscis-employer')`)
    }

    const sql = `
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
        updated_at,
        CASE
          WHEN domain ILIKE '%.lca-employer' OR domain ILIKE '%.uscis-employer' THEN true
          ELSE false
        END AS is_placeholder_domain
      FROM companies
      WHERE ${where.join(" AND ")}
      ORDER BY is_active DESC, COALESCE(job_count, 0) DESC, name ASC
    `

    const { rows } = await pool.query(sql)
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
      "is_placeholder_domain",
    ]

    const lines = [header.map(csvEscape).join(",")]
    for (const row of rows) {
      lines.push(
        header.map((k) => csvEscape((row as Record<string, unknown>)[k])).join(",")
      )
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, lines.join("\n"))

    console.log(
      JSON.stringify({
        output: outPath,
        rows: rows.length,
        inactive_only: inactiveOnly,
        placeholder_only: placeholderOnly,
      })
    )
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

