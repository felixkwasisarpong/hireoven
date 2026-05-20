/**
 * Classify low-job lever companies as junk (deactivate) vs. potentially
 * real (recovery candidate). Uses pattern heuristics — UUID slugs and
 * known staging keywords are unambiguously Lever-internal test boards.
 *
 *   npx tsx scripts/debug-lever-junk-split.ts
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"

// Lever-internal staging / customer-test slug shapes.
const UUID_SLUG_RE = /^c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STAGING_KEYWORDS = new Set([
  "gold","rc","tracking","chirag","partnerexperience","stagevpc",
  "z3nsandboxlaunchpad","stage","staging","test","testing","demo",
  "sandbox","internal","qa",
])
const STAGING_DOMAIN_RE = /\b(staging|arepa|sandbox|qa)\.lever\.co$/i
// Any company whose domain is *.lever.co / *.hire.lever.co is a Lever
// internal subdomain (auth.lever.co, billing.lever.co, …) that crt.sh
// scraping mistakenly enrolled as a company. There are no real companies
// using lever.co subdomains as their primary domain.
const LEVER_INTERNAL_DOMAIN_RE = /\.(hire\.)?lever\.co$/i

function classify(slug: string | null, domain: string | null): "junk_uuid" | "junk_staging" | "junk_lever_subdomain" | "real" {
  const s = (slug ?? "").toLowerCase()
  const d = (domain ?? "").toLowerCase()
  if (UUID_SLUG_RE.test(s)) return "junk_uuid"
  if (STAGING_DOMAIN_RE.test(d)) return "junk_staging"
  if (LEVER_INTERNAL_DOMAIN_RE.test(d)) return "junk_lever_subdomain"
  if (STAGING_KEYWORDS.has(s)) return "junk_staging"
  return "real"
}

async function main() {
  const pool = getPostgresPool()
  try {
    const { rows } = await pool.query<{
      id: string
      name: string
      careers_url: string | null
      direct_ats_url: string | null
      domain: string | null
      active_job_count: number
      last_status: string | null
    }>(
      `WITH c AS (
        SELECT c.id, c.name, c.careers_url, c.direct_ats_url, c.domain,
               (SELECT count(*)::int FROM jobs j WHERE j.company_id = c.id AND j.is_active = true) AS active_job_count
        FROM companies c
        WHERE c.status = 'active' AND c.is_active = true AND c.duplicate_of_company_id IS NULL
          AND c.ats_type = 'lever'
      ),
      latest_log AS (
        SELECT DISTINCT ON (cl.company_id) cl.company_id, cl.status
        FROM crawl_logs cl ORDER BY cl.company_id, cl.crawled_at DESC
      )
      SELECT c.id, c.name, c.careers_url, c.direct_ats_url, c.domain, c.active_job_count,
             l.status AS last_status
      FROM c
      LEFT JOIN latest_log l ON l.company_id = c.id
      WHERE c.active_job_count < 5
      ORDER BY c.name`
    )

    const buckets: Record<string, number> = { junk_uuid: 0, junk_staging: 0, junk_lever_subdomain: 0, real: 0 }
    const realRows: typeof rows = []
    const junkRows: typeof rows = []
    for (const r of rows) {
      const slug = r.careers_url?.replace(/^https?:\/\/jobs\.lever\.co\//, "").replace(/\/.*$/, "") ?? null
      const bucket = classify(slug, r.domain)
      buckets[bucket] += 1
      if (bucket === "real") realRows.push(r)
      else junkRows.push(r)
    }
    console.log(`Low-job Lever rows: ${rows.length}`)
    console.log(`  junk_uuid             (c-<uuid> slug):     ${buckets.junk_uuid}`)
    console.log(`  junk_staging          (staging slug/domain): ${buckets.junk_staging}`)
    console.log(`  junk_lever_subdomain  (domain=*.lever.co): ${buckets.junk_lever_subdomain}`)
    console.log(`  real (likely recoverable):                  ${buckets.real}`)

    // Of the real ones, what's their last status?
    const realByStatus = new Map<string, number>()
    for (const r of realRows) {
      const k = r.last_status ?? "—"
      realByStatus.set(k, (realByStatus.get(k) ?? 0) + 1)
    }
    console.log(`\nReal-row last crawl status:`)
    for (const [k, v] of [...realByStatus.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(12)} ${v}`)
    }

    console.log(`\n=== First 20 "real" recovery candidates ===`)
    for (const r of realRows.slice(0, 20)) {
      console.log(`- ${r.name} | jobs=${r.active_job_count} | last=${r.last_status ?? "—"}\n    domain=${r.domain ?? "∅"} | url=${r.careers_url ?? "∅"}`)
    }

    console.log(`\n=== First 10 junk samples (would deactivate) ===`)
    for (const r of junkRows.slice(0, 10)) {
      console.log(`- ${r.name} | url=${r.careers_url ?? "∅"}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
