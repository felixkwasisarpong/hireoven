/**
 * Preview Greenhouse career URL fixes.
 *
 * Usage:
 *   npx tsx scripts/audit-greenhouse-careers-urls.ts
 *
 * This script does not update the database. It prints affected rows and SQL you
 * can review before applying.
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { normalizeGreenhouseBoardUrl } from "@/lib/companies/greenhouse-url"

loadEnvConfig(process.cwd())

type CompanyRow = {
  id: string
  name: string
  careers_url: string | null
  ats_type: string | null
  raw_ats_config: Record<string, unknown> | null
}

async function getPool(): Promise<Pool> {
  const connStr = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connStr) {
    console.error("Missing DATABASE_URL")
    process.exit(1)
  }
  return new Pool({ connectionString: connStr, ssl: undefined })
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function sqlNullable(value: string | null): string {
  return value ? sqlString(value) : "NULL"
}

function buildManualReviewJson(row: CompanyRow, reason: string) {
  return {
    ...(row.raw_ats_config ?? {}),
    needs_manual_review: true,
    manual_review_reason: reason,
    greenhouse_career_url_audit: {
      original_url: row.careers_url,
      checked_at: new Date().toISOString(),
    },
  }
}

async function main() {
  const pool = await getPool()
  const rows = await pool.query<CompanyRow>(
    `SELECT id, name, careers_url, ats_type, raw_ats_config
     FROM companies
     WHERE careers_url ILIKE '%validityToken%'
        OR (
          ats_type = 'greenhouse'
          AND careers_url IS NOT NULL
          AND (
            careers_url ILIKE '%greenhouse.io/embed%'
            OR careers_url ILIKE '%greenhouse.io/embed/job_board%'
            OR careers_url ILIKE '%job_board?for=%'
          )
        )
     ORDER BY name ASC`
  )

  const affected = rows.rows
  console.log(`\nGreenhouse career URL audit: ${affected.length} affected companies\n`)

  for (const row of affected) {
    const originalUrl = row.careers_url ?? ""
    const normalized = normalizeGreenhouseBoardUrl(originalUrl)
    const reason = normalized.normalizedUrl
      ? normalized.reason
      : "greenhouse_missing_board_token"

    console.log(`${row.name} (${row.id})`)
    console.log(`  original:   ${originalUrl || "(empty)"}`)
    console.log(`  normalized: ${normalized.normalizedUrl ?? "(manual review)"}`)
    console.log(`  reason:     ${reason}`)
    console.log("")
  }

  console.log("Preview SQL:")
  console.log("BEGIN;")

  for (const row of affected) {
    const normalized = normalizeGreenhouseBoardUrl(row.careers_url ?? "")
    if (normalized.normalizedUrl) {
      console.log(
        `UPDATE companies SET careers_url = ${sqlString(normalized.normalizedUrl)}, ats_identifier = COALESCE(ats_identifier, ${sqlNullable(normalized.boardToken)}), updated_at = NOW() WHERE id = ${sqlString(row.id)};`
      )
    } else {
      console.log(
        `UPDATE companies SET raw_ats_config = ${sqlString(JSON.stringify(buildManualReviewJson(row, normalized.reason)))}::jsonb, updated_at = NOW() WHERE id = ${sqlString(row.id)};`
      )
    }
  }

  console.log("ROLLBACK; -- review first, replace with COMMIT to apply manually")
  await pool.end()
}

main().catch((err) => {
  console.error("\naudit-greenhouse-careers-urls failed:", err)
  process.exit(1)
})
