/**
 * Apply only `decision === "apply"` careers-URL repairs (i.e. high-confidence
 * derivations where the previous URL was not already high-confidence).
 *
 * Usage:
 *   npx tsx scripts/apply-high-confidence-careers-url-repairs.ts             # dry-run
 *   npx tsx scripts/apply-high-confidence-careers-url-repairs.ts --execute   # write
 *   npx tsx scripts/apply-high-confidence-careers-url-repairs.ts --probe --execute
 *
 * Strict-rule posture:
 *   - never overwrites a high-confidence URL with another candidate
 *   - never persists a temporary/share URL (normalizeAtsUrl rejects those)
 *   - --probe is opt-in and only fills in low/none rows
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import {
  buildRepairRow,
  type RepairDecision,
} from "@/scripts/preview-careers-url-repairs"
import type { DiscoveryProbe } from "@/lib/companies/careers-url-discovery"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const probeEnabled = process.argv.includes("--probe")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = limitArg ? Math.max(1, Number(limitArg.split("=")[1])) : null
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
    if (!response.ok) {
      return { ok: false, status: response.status, html: null }
    }
    const html = await response.text()
    return { ok: true, status: response.status, html }
  } catch {
    return { ok: false, status: null, html: null }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function loadApplyUrlsByCompany(pool: Pool): Promise<Map<string, string[]>> {
  const { rows } = await pool.query<{
    company_id: string
    apply_url: string
  }>(
    `SELECT company_id, apply_url FROM jobs
     WHERE is_active = true AND apply_url IS NOT NULL`
  )
  const map = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.company_id || !row.apply_url) continue
    const list = map.get(row.company_id) ?? []
    list.push(row.apply_url)
    map.set(row.company_id, list)
  }
  return map
}

async function main() {
  const pool = getPool()
  console.log(
    `\n[careers-url-repair] mode=${execute ? "EXECUTE" : "DRY-RUN"}, probe=${probeEnabled}`
  )

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
       ORDER BY name${limit ? ` LIMIT ${limit}` : ""}`
    )

    const applyUrlsByCompany = await loadApplyUrlsByCompany(pool)

    const counts = new Map<RepairDecision, number>()
    let updated = 0

    for (const company of rows) {
      const applyUrls = applyUrlsByCompany.get(company.id) ?? []
      const row = await buildRepairRow(company, applyUrls, {
        probe: probeEnabled ? httpProbe : undefined,
      })
      counts.set(row.decision, (counts.get(row.decision) ?? 0) + 1)

      if (row.decision !== "apply") continue

      console.log(
        `  ${execute ? "" : "[dry] "}${company.name.slice(0, 36).padEnd(36)}\n` +
          `    ${row.prev ?? "(none)"}\n` +
          `    → ${row.next.url}   (${row.next.reason})`
      )

      if (execute) {
        await pool.query(
          `UPDATE companies
           SET careers_url = $1, updated_at = NOW()
           WHERE id = $2`,
          [row.next.url, company.id]
        )
      }
      updated += 1
    }

    console.log(
      `\n${execute ? "Updated" : "Would update"} ${updated} companies. Counts:`
    )
    for (const decision of [
      "apply",
      "skip-equal",
      "skip-prev-high",
      "review",
      "none",
    ] as RepairDecision[]) {
      console.log(`  ${decision.padEnd(16)} ${counts.get(decision) ?? 0}`)
    }

    if (!execute) {
      console.log(`\nAppend --execute to apply these changes.`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
