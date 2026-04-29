/**
 * Export medium- and low-confidence careers-URL repair candidates as CSV.
 * Use this list for manual review and decisions about whether to keep the
 * existing URL or replace it with the suggested one.
 *
 * Usage:
 *   npx tsx scripts/export-low-confidence-careers-review.ts > review.csv
 *   npx tsx scripts/export-low-confidence-careers-review.ts --probe > review.csv
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { buildRepairRow } from "@/scripts/preview-careers-url-repairs"
import type { DiscoveryProbe } from "@/lib/companies/careers-url-discovery"

loadEnvConfig(process.cwd())

const probeEnabled = process.argv.includes("--probe")
const probeTimeoutMs = Math.max(
  2000,
  Number.parseInt(process.env.CRAWLER_PROBE_TIMEOUT_MS ?? "8000", 10)
)

function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl:
      process.env.PGSSLMODE === "require"
        ? { rejectUnauthorized: false }
        : undefined,
  })
}

const httpProbe: DiscoveryProbe = async ({ url, signal }) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), probeTimeoutMs)
  const composite = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: composite,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; HireovenCareersDiscoveryBot/1.0; +https://hireoven.com)",
      },
    })
    if (!response.ok) return { ok: false, status: response.status, html: null }
    const html = await response.text()
    return { ok: true, status: response.status, html }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(timeoutId)
  }
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

async function main() {
  const pool = getPool()

  try {
    const { rows } = await pool.query<{
      id: string
      name: string
      domain: string | null
      careers_url: string | null
      ats_type: string | null
      ats_identifier: string | null
    }>(
      `SELECT id, name, domain, careers_url, ats_type, ats_identifier
       FROM companies
       WHERE is_active = true
       ORDER BY name`
    )

    const jobsRes = await pool.query<{ company_id: string; apply_url: string }>(
      `SELECT company_id, apply_url FROM jobs
       WHERE is_active = true AND apply_url IS NOT NULL`
    )
    const applyUrlsByCompany = new Map<string, string[]>()
    for (const r of jobsRes.rows) {
      if (!r.company_id || !r.apply_url) continue
      const list = applyUrlsByCompany.get(r.company_id) ?? []
      list.push(r.apply_url)
      applyUrlsByCompany.set(r.company_id, list)
    }

    console.log(
      [
        "id",
        "name",
        "domain",
        "ats_type",
        "decision",
        "prev_confidence",
        "next_confidence",
        "next_reason",
        "prev_url",
        "next_url",
      ]
        .map(csvEscape)
        .join(",")
    )

    for (const company of rows) {
      const applyUrls = applyUrlsByCompany.get(company.id) ?? []
      const row = await buildRepairRow(company, applyUrls, {
        probe: probeEnabled ? httpProbe : undefined,
      })

      if (row.decision !== "review" && row.decision !== "none") continue

      console.log(
        [
          row.company.id,
          row.company.name,
          row.company.domain,
          row.company.ats_type,
          row.decision,
          row.prevConfidence,
          row.next.confidence,
          row.next.reason,
          row.prev,
          row.next.url,
        ]
          .map(csvEscape)
          .join(",")
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
