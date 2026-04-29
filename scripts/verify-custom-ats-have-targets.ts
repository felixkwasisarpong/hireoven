/**
 * For every active company with ats_type='custom' (or null), verify that the
 * stored careers_url is something the crawler can reach. Without --probe the
 * check is URL-shape only (scoreCareersUrl); with --probe each candidate is
 * fetched and the response classified via classifyCareersPageHtml.
 *
 * Exits non-zero if any company has a careers URL with confidence='none' (no
 * usable target). Useful as a CI gate.
 *
 * Usage:
 *   npx tsx scripts/verify-custom-ats-have-targets.ts
 *   npx tsx scripts/verify-custom-ats-have-targets.ts --probe
 *   npx tsx scripts/verify-custom-ats-have-targets.ts --csv
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import {
  classifyCareersPageHtml,
  scoreCareersUrl,
  type CareersUrlConfidence,
} from "@/lib/companies/careers-url-discovery"

loadEnvConfig(process.cwd())

const probeEnabled = process.argv.includes("--probe")
const csvOnly = process.argv.includes("--csv")
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

async function probeUrl(url: string): Promise<{
  ok: boolean
  status: number | null
  html: string | null
}> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), probeTimeoutMs)
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
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
      job_count: number | null
    }>(
      `SELECT id, name, domain, careers_url, ats_type, job_count
       FROM companies
       WHERE is_active = true
         AND (ats_type = 'custom' OR ats_type IS NULL)
       ORDER BY name`
    )

    const counts = new Map<CareersUrlConfidence, number>()
    let badRows = 0
    if (csvOnly) {
      console.log(
        ["id", "name", "domain", "ats_type", "careers_url", "shape_confidence", "probe_confidence", "probe_reason", "job_count"]
          .map(csvEscape)
          .join(",")
      )
    }

    const samples: Array<{
      name: string
      url: string | null
      shape: CareersUrlConfidence
      probe: CareersUrlConfidence | null
      reason: string | null
    }> = []

    for (const row of rows) {
      const shape = scoreCareersUrl(row.careers_url)
      let probeConfidence: CareersUrlConfidence | null = null
      let probeReason: string | null = null

      if (probeEnabled && row.careers_url && shape.confidence !== "none") {
        const result = await probeUrl(row.careers_url)
        if (!result.ok || !result.html) {
          probeConfidence = "none"
          probeReason = `http_${result.status ?? "error"}`
        } else {
          const c = classifyCareersPageHtml({ url: row.careers_url, html: result.html })
          probeConfidence = c.confidence
          probeReason = c.reason
        }
      }

      const finalConfidence = probeConfidence ?? shape.confidence
      counts.set(finalConfidence, (counts.get(finalConfidence) ?? 0) + 1)
      if (finalConfidence === "none" || finalConfidence === "low") badRows += 1

      if (csvOnly) {
        console.log(
          [
            row.id,
            row.name,
            row.domain,
            row.ats_type,
            row.careers_url,
            shape.confidence,
            probeConfidence ?? "",
            probeReason ?? "",
            row.job_count,
          ]
            .map(csvEscape)
            .join(",")
        )
      } else if (finalConfidence === "none" || finalConfidence === "low") {
        if (samples.length < 30) {
          samples.push({
            name: row.name,
            url: row.careers_url,
            shape: shape.confidence,
            probe: probeConfidence,
            reason: probeReason ?? shape.reason,
          })
        }
      }
    }

    if (csvOnly) {
      if (badRows > 0) process.exitCode = 1
      return
    }

    console.log(`\nVerify custom-ATS careers URLs (probe=${probeEnabled})`)
    console.log(`Total custom/null companies: ${rows.length}\n`)
    for (const c of ["high", "medium", "low", "none"] as CareersUrlConfidence[]) {
      console.log(`  ${c.padEnd(8)} ${counts.get(c) ?? 0}`)
    }

    if (samples.length > 0) {
      console.log(`\nSample bad rows (up to 30):`)
      for (const sample of samples) {
        console.log(
          `  [shape=${sample.shape}${sample.probe ? `, probe=${sample.probe}` : ""}] ${sample.name
            .slice(0, 32)
            .padEnd(32)} ${sample.url ?? "(none)"}  (${sample.reason ?? "?"})`
        )
      }
    }

    if (badRows > 0) {
      console.log(
        `\n✗ ${badRows} companies have a careers_url that is not crawlable. ` +
          `Run scripts/preview-careers-url-repairs.ts.`
      )
      process.exitCode = 1
    } else {
      console.log("\n✓ All custom-ATS companies have a usable careers URL target.")
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
