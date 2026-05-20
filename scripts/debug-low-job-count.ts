/**
 * Read-only diagnostic: companies with fewer than N active jobs. Reports
 * count, adapter, last-crawl age and last-crawl status so we can tell
 * whether the company is genuinely tiny, never-crawled, or persistently
 * failing.
 *
 *   npx tsx scripts/debug-low-job-count.ts             # default threshold = 5
 *   npx tsx scripts/debug-low-job-count.ts 10          # < 10 jobs
 *   npx tsx scripts/debug-low-job-count.ts 5 --by-ats  # only summary, no rows
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

type Row = {
  id: string
  name: string
  ats_type: string | null
  job_count: number
  active_job_count: number
  careers_url: string | null
  direct_ats_url: string | null
  last_crawled_at: Date | null
  next_harvest_at: Date | null
  freshness_tier: string | null
  last_status: string | null
  last_error: string | null
  last_log_at: Date | null
}

function ageString(d: Date | null): string {
  if (!d) return "never"
  const sec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86_400)}d ago`
}

async function main() {
  const threshold = Number.parseInt(process.argv[2] ?? "5", 10)
  const summaryOnly = process.argv.includes("--by-ats")

  const pool = getPostgresPool()
  try {
    // active_job_count is computed fresh so we don't trust a stale
    // companies.job_count cache. Limit pulled rows but keep the count.
    const totalRes = await pool.query<{ total: string }>(
      `SELECT count(*)::text AS total
       FROM companies
       WHERE status = 'active' AND is_active = true AND duplicate_of_company_id IS NULL`
    )
    const total = Number.parseInt(totalRes.rows[0]?.total ?? "0", 10)

    const lowRes = await pool.query<Row>(
      `WITH c AS (
        SELECT c.id, c.name, c.ats_type, c.job_count,
               c.careers_url, c.direct_ats_url,
               c.last_crawled_at, c.next_harvest_at, c.freshness_tier,
               (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.id AND j.is_active = true) AS active_job_count
        FROM companies c
        WHERE c.status = 'active' AND c.is_active = true AND c.duplicate_of_company_id IS NULL
      ),
      latest_log AS (
        SELECT DISTINCT ON (cl.company_id)
               cl.company_id, cl.status, cl.error_message, cl.crawled_at
        FROM crawl_logs cl
        ORDER BY cl.company_id, cl.crawled_at DESC
      )
      SELECT c.id, c.name, c.ats_type, c.job_count, c.active_job_count,
             c.careers_url, c.direct_ats_url,
             c.last_crawled_at, c.next_harvest_at, c.freshness_tier,
             l.status AS last_status, l.error_message AS last_error,
             l.crawled_at AS last_log_at
      FROM c
      LEFT JOIN latest_log l ON l.company_id = c.id
      WHERE c.active_job_count < $1
      ORDER BY c.active_job_count ASC, c.name ASC`,
      [threshold]
    )

    const rows = lowRes.rows
    console.log(`Active companies total: ${total}`)
    console.log(`With <${threshold} active jobs: ${rows.length} (${((rows.length / total) * 100).toFixed(1)}%)\n`)

    // ── Summary by ats_type ───────────────────────────────────────────
    const byAts = new Map<string, { total: number; zero: number; neverCrawled: number; lastFailed: number }>()
    for (const r of rows) {
      const key = r.ats_type ?? "(null)"
      const cur = byAts.get(key) ?? { total: 0, zero: 0, neverCrawled: 0, lastFailed: 0 }
      cur.total += 1
      if (r.active_job_count === 0) cur.zero += 1
      if (!r.last_crawled_at) cur.neverCrawled += 1
      if (r.last_status === "failed") cur.lastFailed += 1
      byAts.set(key, cur)
    }
    console.log("By ats_type (low-job companies):")
    console.log("  ats_type            total  zero-jobs  never-crawled  last-crawl-failed")
    for (const [k, v] of [...byAts.entries()].sort((a, b) => b[1].total - a[1].total)) {
      console.log(
        `  ${k.padEnd(18)}  ${String(v.total).padStart(5)}      ${String(v.zero).padStart(5)}          ${String(v.neverCrawled).padStart(5)}              ${String(v.lastFailed).padStart(5)}`
      )
    }

    // ── Bucket by failure mode ────────────────────────────────────────
    const neverCrawled = rows.filter((r) => !r.last_crawled_at)
    const zeroJobs = rows.filter((r) => r.active_job_count === 0)
    const lastFailed = rows.filter((r) => r.last_status === "failed")
    const successButLow = rows.filter(
      (r) => r.last_status && r.last_status !== "failed" && r.active_job_count > 0
    )
    console.log("\nBuckets (overlapping):")
    console.log(`  never crawled:                       ${neverCrawled.length}`)
    console.log(`  active_job_count = 0:                ${zeroJobs.length}`)
    console.log(`  last crawl_log status = failed:      ${lastFailed.length}`)
    console.log(`  last crawl_log succeeded, still <${threshold}: ${successButLow.length}`)

    // ── Top failure reasons among the last-failed bucket ──────────────
    if (lastFailed.length > 0) {
      const reasons = new Map<string, number>()
      for (const r of lastFailed) {
        const msg = (r.last_error ?? "unknown").slice(0, 80)
        reasons.set(msg, (reasons.get(msg) ?? 0) + 1)
      }
      console.log("\nTop last-crawl error messages (truncated 80c):")
      for (const [k, v] of [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
        console.log(`  ${String(v).padStart(4)}  ${k}`)
      }
    }

    if (summaryOnly) return

    // ── Sample rows ────────────────────────────────────────────────────
    console.log("\n=== Sample (first 25) ===")
    for (const r of rows.slice(0, 25)) {
      console.log(
        `- ${r.name} | ats_type=${r.ats_type ?? "∅"} | jobs=${r.active_job_count} | tier=${r.freshness_tier ?? "∅"}\n    last_crawled=${ageString(r.last_crawled_at)} | last_status=${r.last_status ?? "—"} | next=${ageString(r.next_harvest_at)}\n    careers_url=${r.careers_url ?? "∅"}${r.last_error ? `\n    error=${r.last_error.slice(0, 200)}` : ""}`
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
