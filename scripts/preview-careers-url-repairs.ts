/**
 * Dry-run preview of careers-URL repairs across all active companies.
 *
 * For each active company:
 *   1. Read current careers_url + ats_type/identifier + recent apply URLs.
 *   2. Run deriveCanonicalCareersUrlWithConfidence (no network).
 *   3. Optionally probe candidate paths (--probe) when result is low/none.
 *   4. Print a row showing prev → next + confidence + decision label.
 *
 * Decision labels:
 *   apply       — would replace (next is high AND prev was not already high)
 *   skip-equal  — derived URL is identical to current
 *   skip-prev-high — current URL is already high confidence; do not overwrite
 *   review      — derived URL is medium; needs manual review
 *   none        — could not derive a usable URL
 *
 * Usage:
 *   npx tsx scripts/preview-careers-url-repairs.ts
 *   npx tsx scripts/preview-careers-url-repairs.ts --probe       # try HTTP probing for low/none rows
 *   npx tsx scripts/preview-careers-url-repairs.ts --limit=100
 *   npx tsx scripts/preview-careers-url-repairs.ts --csv          # full CSV
 */

import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import {
  deriveCanonicalCareersUrlWithConfidence,
  type CanonicalCareersUrlResult,
} from "@/lib/companies/canonical-careers-url"
import {
  discoverCareersUrl,
  scoreCareersUrl,
  type DiscoveryProbe,
} from "@/lib/companies/careers-url-discovery"
import { isTemporaryCareersUrl } from "@/lib/companies/ats-domains"

loadEnvConfig(process.cwd())

const probeEnabled = process.argv.includes("--probe")
const csvOnly = process.argv.includes("--csv")
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

type Company = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
  ats_identifier: string | null
}

export type RepairDecision =
  | "apply"
  | "skip-equal"
  | "skip-prev-high"
  | "review"
  | "none"

export type RepairRow = {
  company: Company
  prev: string | null
  next: CanonicalCareersUrlResult
  decision: RepairDecision
  prevConfidence: "high" | "medium" | "low" | "none"
}

export function classifyRepair(input: {
  company: Company
  derived: CanonicalCareersUrlResult
}): RepairRow {
  const prev = input.company.careers_url?.trim() ?? null
  const prevScore = scoreCareersUrl(prev)
  const next = input.derived

  let decision: RepairDecision = "none"

  if (next.confidence === "none") {
    decision = "none"
  } else if (prev && next.url === prev) {
    decision = "skip-equal"
  } else if (next.confidence === "high") {
    if (
      prevScore.confidence === "high" &&
      !isTemporaryCareersUrl(prev)
    ) {
      // Don't overwrite an existing high-confidence URL even with another
      // high-confidence candidate — that's a company-moved-ATS case that
      // deserves explicit review.
      decision = "skip-prev-high"
    } else {
      decision = "apply"
    }
  } else if (next.confidence === "medium") {
    decision = "review"
  } else {
    decision = "review"
  }

  return {
    company: input.company,
    prev,
    next,
    decision,
    prevConfidence: prevScore.confidence,
  }
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
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

export async function buildRepairRow(
  company: Company,
  applyUrls: string[],
  options?: { probe?: DiscoveryProbe }
): Promise<RepairRow> {
  let derived = deriveCanonicalCareersUrlWithConfidence(
    {
      domain: company.domain ?? "",
      careers_url: company.careers_url ?? "",
      ats_type: company.ats_type,
      ats_identifier: company.ats_identifier,
    },
    { applyUrls }
  )

  if (
    options?.probe &&
    company.domain &&
    (derived.confidence === "low" || derived.confidence === "none")
  ) {
    const discovered = await discoverCareersUrl({
      domain: company.domain,
      probe: options.probe,
    })
    // Outer guard restricts derived.confidence to "low" | "none" here, so any
    // probe result of "medium" or "high" is strictly an upgrade.
    if (discovered.confidence === "high" || discovered.confidence === "medium") {
      derived = {
        url: discovered.url,
        confidence: discovered.confidence,
        reason: `probe:${discovered.reason}`,
      }
    }
  }

  return classifyRepair({ company, derived })
}

async function main() {
  const pool = getPool()

  try {
    const { rows } = await pool.query<Company>(
      `SELECT id, name, domain, careers_url, ats_type, ats_identifier
       FROM companies
       WHERE is_active = true
       ORDER BY name${limit ? ` LIMIT ${limit}` : ""}`
    )

    const applyUrlsByCompany = await loadApplyUrlsByCompany(pool)

    const repairRows: RepairRow[] = []
    for (const company of rows) {
      const applyUrls = applyUrlsByCompany.get(company.id) ?? []
      const row = await buildRepairRow(company, applyUrls, {
        probe: probeEnabled ? httpProbe : undefined,
      })
      repairRows.push(row)
    }

    if (csvOnly) {
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
      for (const row of repairRows) {
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
      return
    }

    const counts = new Map<RepairDecision, number>()
    for (const row of repairRows) {
      counts.set(row.decision, (counts.get(row.decision) ?? 0) + 1)
    }

    console.log(`\nCareers-URL repair preview (probe=${probeEnabled})`)
    console.log(`Total scanned: ${repairRows.length}`)
    for (const decision of [
      "apply",
      "skip-equal",
      "skip-prev-high",
      "review",
      "none",
    ] as RepairDecision[]) {
      console.log(`  ${decision.padEnd(16)} ${counts.get(decision) ?? 0}`)
    }

    const sample = repairRows
      .filter((row) => row.decision === "apply")
      .slice(0, 30)
    if (sample.length > 0) {
      console.log(`\nSample 'apply' rows (up to 30):`)
      for (const row of sample) {
        console.log(
          `  [${row.next.confidence}] ${row.company.name.slice(0, 32).padEnd(32)}\n` +
            `    ${row.prev ?? "(none)"}\n` +
            `    → ${row.next.url}  (${row.next.reason})`
        )
      }
    }

    const reviewSample = repairRows
      .filter((row) => row.decision === "review")
      .slice(0, 20)
    if (reviewSample.length > 0) {
      console.log(`\nSample 'review' rows (up to 20):`)
      for (const row of reviewSample) {
        console.log(
          `  [${row.next.confidence}] ${row.company.name.slice(0, 32).padEnd(32)} ${row.next.url}  (${row.next.reason})`
        )
      }
    }

    console.log(
      `\nNext step: run scripts/apply-high-confidence-careers-url-repairs.ts --execute`
    )
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
