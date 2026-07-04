/**
 * Audit daily crawl/harvest coverage from crawl_logs attempts.
 *
 * last_crawled_at only moves on successful/non-modified harvests, so it is not
 * the right SLA metric for "was every company touched today?". This script uses
 * the latest crawl_logs row per company and can optionally queue missed rows by
 * setting next_harvest_at=now().
 *
 * Usage:
 *   npx tsx scripts/audit-harvester-coverage.ts
 *   npx tsx scripts/audit-harvester-coverage.ts --older-than-hours=24
 *   npx tsx scripts/audit-harvester-coverage.ts --ats=workable
 *   npx tsx scripts/audit-harvester-coverage.ts --queue-missed --execute --limit=1000
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((arg) => arg.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

function intFlag(name: string, fallback: number, min = 1): number {
  const parsed = Number.parseInt(flag(name) ?? "", 10)
  if (!Number.isFinite(parsed) || parsed < min) return fallback
  return parsed
}

const execute = process.argv.includes("--execute")
const queueMissed = process.argv.includes("--queue-missed")
const olderThanHours = intFlag("older-than-hours", 24)
const limit = Number.parseInt(flag("limit") ?? "", 10)
const limitValue = Number.isFinite(limit) && limit > 0 ? limit : null
const atsFilter = (flag("ats") ?? "")
  .split(",")
  .map((part) => part.trim().toLowerCase())
  .filter(Boolean)
const reportPath =
  flag("report") ||
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `harvester-coverage-${new Date().toISOString().slice(0, 10)}.json`
  )

type AdapterCoverageRow = {
  adapter: string
  active: number
  attempted_window: number
  never_attempted: number
  bumped_window: number
  due_now: number
  missed_window: number
}

type FailureRow = {
  adapter: string
  status: string
  reason: string
  count: number
}

type TotalRow = {
  active_crawlable: number
  attempted_window: number
  never_attempted: number
  bumped_window: number
  due_now: number
  missed_window: number
}

type QueueRow = {
  id: string
  name: string
  adapter: string
  last_attempt_at: string | null
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

function toIntRows<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row }
    for (const [key, value] of Object.entries(out)) {
      if (typeof value === "string" && /^-?\d+$/.test(value)) out[key] = Number.parseInt(value, 10)
    }
    return out as T
  })
}

function atsWhere(alias: string, params: unknown[]): string {
  if (atsFilter.length === 0) return ""
  params.push(atsFilter)
  return `AND COALESCE(NULLIF(${alias}.ats_type, ''), 'unknown_or_custom') = ANY($${params.length}::text[])`
}

function adapterWhere(alias: string, params: unknown[]): string {
  if (atsFilter.length === 0) return ""
  params.push(atsFilter)
  return `AND ${alias}.adapter = ANY($${params.length}::text[])`
}

function limitSql(params: unknown[]): string {
  if (!limitValue) return ""
  params.push(limitValue)
  return `LIMIT $${params.length}::int`
}

async function main() {
  const pool = getPool()
  try {
    const coverageParams: unknown[] = [olderThanHours]
    const coverageAtsWhere = adapterWhere("a", coverageParams)
    const coverage = await pool.query<AdapterCoverageRow>(
      `
      WITH active AS (
        SELECT c.id,
               COALESCE(NULLIF(c.ats_type, ''), 'unknown_or_custom') AS adapter,
               c.last_crawled_at,
               c.next_harvest_at
        FROM companies c
        WHERE c.status = 'active'
          AND c.is_active = true
          AND c.duplicate_of_company_id IS NULL
          AND c.careers_url IS NOT NULL
          AND btrim(c.careers_url) <> ''
      ), latest AS (
        SELECT company_id, max(crawled_at) AS last_attempt_at
        FROM crawl_logs
        GROUP BY company_id
      )
      SELECT a.adapter,
             count(*) AS active,
             count(*) FILTER (WHERE l.last_attempt_at >= now() - ($1::int || ' hours')::interval) AS attempted_window,
             count(*) FILTER (WHERE l.last_attempt_at IS NULL) AS never_attempted,
             count(*) FILTER (WHERE a.last_crawled_at >= now() - ($1::int || ' hours')::interval) AS bumped_window,
             count(*) FILTER (WHERE a.next_harvest_at IS NULL OR a.next_harvest_at <= now()) AS due_now,
             count(*) FILTER (WHERE l.last_attempt_at IS NULL OR l.last_attempt_at < now() - ($1::int || ' hours')::interval) AS missed_window
      FROM active a
      LEFT JOIN latest l ON l.company_id = a.id
      WHERE true
        ${coverageAtsWhere}
      GROUP BY a.adapter
      ORDER BY missed_window DESC, active DESC
      `,
      coverageParams
    )

    const totalParams: unknown[] = [olderThanHours]
    const totalAtsWhere = atsWhere("c", totalParams)
    const totals = await pool.query<TotalRow>(
      `
      WITH active AS (
        SELECT c.id, c.last_crawled_at, c.next_harvest_at
        FROM companies c
        WHERE c.status = 'active'
          AND c.is_active = true
          AND c.duplicate_of_company_id IS NULL
          AND c.careers_url IS NOT NULL
          AND btrim(c.careers_url) <> ''
          ${totalAtsWhere}
      ), latest AS (
        SELECT company_id, max(crawled_at) AS last_attempt_at
        FROM crawl_logs
        GROUP BY company_id
      )
      SELECT count(*) AS active_crawlable,
             count(*) FILTER (WHERE l.last_attempt_at >= now() - ($1::int || ' hours')::interval) AS attempted_window,
             count(*) FILTER (WHERE l.last_attempt_at IS NULL) AS never_attempted,
             count(*) FILTER (WHERE a.last_crawled_at >= now() - ($1::int || ' hours')::interval) AS bumped_window,
             count(*) FILTER (WHERE a.next_harvest_at IS NULL OR a.next_harvest_at <= now()) AS due_now,
             count(*) FILTER (WHERE l.last_attempt_at IS NULL OR l.last_attempt_at < now() - ($1::int || ' hours')::interval) AS missed_window
      FROM active a
      LEFT JOIN latest l ON l.company_id = a.id
      `,
      totalParams
    )

    const failureParams: unknown[] = [olderThanHours]
    const failureAtsWhere = atsWhere("c", failureParams)
    const failures = await pool.query<FailureRow>(
      `
      WITH latest AS (
        SELECT DISTINCT ON (cl.company_id)
               cl.company_id,
               cl.status,
               cl.crawled_at,
               cl.error_message
        FROM crawl_logs cl
        ORDER BY cl.company_id, cl.crawled_at DESC
      )
      SELECT COALESCE(NULLIF(c.ats_type, ''), 'unknown_or_custom') AS adapter,
             l.status,
             CASE
               WHEN l.error_message ILIKE '%429%' OR l.error_message ILIKE '%rate limit%' OR l.error_message ILIKE '%too many requests%' THEN 'rate_limited'
               WHEN l.error_message ILIKE '%403%' OR l.error_message ILIKE '%forbidden%' OR l.error_message ILIKE '%blocked%' THEN 'blocked_403'
               WHEN l.error_message ILIKE '%404%' OR l.error_message ILIKE '%not found%' THEN 'gone_404'
               WHEN l.error_message ILIKE '%timeout%' OR l.error_message ILIKE '%abort%' THEN 'timeout'
               WHEN l.error_message ILIKE '%fetch failed%' OR l.error_message ILIKE '%fetch_error%' THEN 'fetch_error'
               WHEN l.error_message IS NULL THEN 'none'
               ELSE left(regexp_replace(l.error_message, '\\s+', ' ', 'g'), 80)
             END AS reason,
             count(*) AS count
      FROM companies c
      JOIN latest l ON l.company_id = c.id
      WHERE c.status = 'active'
        AND c.is_active = true
        AND c.duplicate_of_company_id IS NULL
        AND c.careers_url IS NOT NULL
        AND btrim(c.careers_url) <> ''
        AND l.crawled_at >= now() - ($1::int || ' hours')::interval
        AND l.status = 'failed'
        ${failureAtsWhere}
      GROUP BY 1, 2, 3
      ORDER BY count DESC
      LIMIT 35
      `,
      failureParams
    )

    let queued: QueueRow[] = []
    if (queueMissed) {
      const queueParams: unknown[] = [olderThanHours]
      const queueAtsWhere = atsWhere("c", queueParams)
      const queueLimit = limitSql(queueParams)
      const queueSql = `
        WITH latest AS (
          SELECT company_id, max(crawled_at) AS last_attempt_at
          FROM crawl_logs
          GROUP BY company_id
        ), targets AS (
          SELECT c.id,
                 c.name,
                 COALESCE(NULLIF(c.ats_type, ''), 'unknown_or_custom') AS adapter,
                 l.last_attempt_at
          FROM companies c
          LEFT JOIN latest l ON l.company_id = c.id
          WHERE c.status = 'active'
            AND c.is_active = true
            AND c.duplicate_of_company_id IS NULL
            AND c.careers_url IS NOT NULL
            AND btrim(c.careers_url) <> ''
            AND (l.last_attempt_at IS NULL OR l.last_attempt_at < now() - ($1::int || ' hours')::interval)
            ${queueAtsWhere}
          ORDER BY l.last_attempt_at ASC NULLS FIRST, c.updated_at ASC
          ${queueLimit}
        )
        ${
          execute
            ? `UPDATE companies c
               SET next_harvest_at = now(), updated_at = now()
               FROM targets t
               WHERE c.id = t.id
               RETURNING c.id, c.name, t.adapter, t.last_attempt_at::text`
            : `SELECT id, name, adapter, last_attempt_at::text FROM targets`
        }
      `
      const result = await pool.query<QueueRow>(queueSql, queueParams)
      queued = result.rows
    }

    const normalizedCoverage = toIntRows(coverage.rows)
    const normalizedFailures = toIntRows(failures.rows)
    const normalizedTotals = toIntRows(totals.rows)[0]

    console.log("")
    console.log(`[harvester-coverage] window=${olderThanHours}h mode=${execute ? "EXECUTE" : "dry-run"}`)
    if (atsFilter.length > 0) console.log(`ats=${atsFilter.join(",")}`)
    console.table([normalizedTotals])
    console.log("")
    console.log("coverage_by_adapter")
    console.table(normalizedCoverage)
    console.log("")
    console.log("latest_failure_reasons")
    console.table(normalizedFailures)

    if (queueMissed) {
      console.log("")
      console.log(`${execute ? "queued" : "would queue"} missed companies: ${queued.length}`)
      for (const row of queued.slice(0, 25)) {
        console.log(`  ${row.adapter.padEnd(18)} ${row.name.slice(0, 64)} ${row.last_attempt_at ?? "never"}`)
      }
    }

    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          window_hours: olderThanHours,
          execute,
          queue_missed: queueMissed,
          ats_filter: atsFilter,
          limit: limitValue,
          totals: normalizedTotals,
          coverage_by_adapter: normalizedCoverage,
          latest_failure_reasons: normalizedFailures,
          queued,
        },
        null,
        2
      )
    )
    console.log(`report=${reportPath}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
