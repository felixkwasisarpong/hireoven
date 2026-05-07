/**
 * Repair careers URLs for trending tech companies that are still zero-job and
 * crawl-allowed, then optionally persist updates.
 *
 * Usage:
 *   npx tsx scripts/repair-trending-tech-zero-job-careers-urls.ts
 *   npx tsx scripts/repair-trending-tech-zero-job-careers-urls.ts --execute
 *   npx tsx scripts/repair-trending-tech-zero-job-careers-urls.ts --execute --limit=15
 */

import fs from "node:fs"
import path from "node:path"
import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import {
  discoverCareersUrl,
  scoreCareersUrl,
  type CareersUrlConfidence,
} from "@/lib/companies/careers-url-discovery"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes("--execute")
const includeLow = process.argv.includes("--include-low")
const forceAll = process.argv.includes("--force-all")
const limit = Number(flag("limit")) || undefined
const concurrency = Math.max(1, Number(flag("concurrency")) || 12)
const probeTimeoutMs = Math.max(1500, Number(flag("timeout-ms")) || 4500)
const reportPath =
  flag("report") ||
  path.join(
    process.cwd(),
    "scripts",
    "output",
    `trending-tech-zero-job-repair-report-${new Date().toISOString().slice(0, 10)}.json`
  )

const TRENDING_TECH_DOMAINS = [
  "x.ai",
  "mistral.ai",
  "ssi.inc",
  "thinkingmachines.ai",
  "worldlabs.ai",
  "cognition.ai",
  "windsurf.com",
  "sierra.ai",
  "decagon.ai",
  "skild.ai",
  "groq.com",
  "together.ai",
  "fireworks.ai",
  "baseten.co",
  "lambda.ai",
  "writer.com",
  "suno.com",
  "pika.art",
  "elevenlabs.io",
  "runwayml.com",
  "figure.ai",
  "hebbia.ai",
  "crusoe.ai",
  "vastdata.com",
  "vannevarlabs.com",
  "abridge.com",
  "poolside.ai",
  "adept.ai",
  "mosaicml.com",
  "octoml.ai",
  "langchain.com",
  "mercor.com",
  "anduril.com",
  "shield.ai",
  "appliedintuition.com",
  "rebelliondefense.com",
  "wayve.ai",
  "waabi.ai",
  "synthesia.io",
  "runpod.io",
  "modal.com",
  "wandb.ai",
  "replicate.com",
  "pinecone.io",
  "motherduck.com",
] as const

const BLOCKLIST_HOSTS = ["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com"]

type CompanyRow = {
  id: string
  name: string
  domain: string
  careers_url: string | null
  ats_type: string | null
  ats_identifier: string | null
  job_count: number | null
  crawl_allowed: boolean
}

type Candidate = {
  company_id: string
  name: string
  domain: string
  prev_url: string
  prev_confidence: CareersUrlConfidence
  next_url: string
  next_confidence: CareersUrlConfidence
  reason: string
  next_ats_type: string | null
  next_ats_identifier: string | null
}

function confidenceRank(confidence: CareersUrlConfidence): number {
  switch (confidence) {
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
    default:
      return 0
  }
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isBlocklistedHost(host: string | null): boolean {
  if (!host) return false
  return BLOCKLIST_HOSTS.some((suffix) => host.includes(suffix))
}

async function probeUrl(url: string, signal?: AbortSignal) {
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

function writeReport(payload: unknown): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2))
  console.log(`[trending-repair] report: ${reportPath}`)
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })

  console.log(
    `[trending-repair] mode=${execute ? "EXECUTE" : "dry-run"} includeLow=${includeLow} forceAll=${forceAll} limit=${limit ?? "all"} concurrency=${concurrency}`
  )

  try {
    const cappedSql = limit ? `LIMIT ${limit}` : ""
    const { rows } = await pool.query<CompanyRow>(
      `SELECT
         id,
         name,
         lower(domain) AS domain,
         careers_url,
         ats_type,
         ats_identifier,
         job_count,
         COALESCE((raw_ats_config->>'crawl_allowed')::boolean, true) AS crawl_allowed
       FROM companies
       WHERE lower(domain) = ANY($1::text[])
         AND is_active = true
         AND COALESCE(job_count, 0) = 0
         AND COALESCE((raw_ats_config->>'crawl_allowed')::boolean, true) = true
       ORDER BY domain
       ${cappedSql}`,
      [TRENDING_TECH_DOMAINS]
    )

    const report = {
      mode: execute ? "execute" : "dry-run",
      generated_at: new Date().toISOString(),
      scanned: rows.length,
      candidates: [] as Candidate[],
      applied: 0,
      skipped_no_domain: 0,
      skipped_not_suspect: 0,
      discovered_none: 0,
      discovered_not_better: 0,
    }

    const limiter = pLimit(concurrency)

    await Promise.all(
      rows.map((company) =>
        limiter(async () => {
          const domain = (company.domain ?? "").trim().toLowerCase().replace(/^www\./, "")
          const prevUrl = (company.careers_url ?? "").trim()

          if (!domain) {
            report.skipped_no_domain += 1
            return
          }

          const prevScore = scoreCareersUrl(prevUrl)
          const prevHost = hostFromUrl(prevUrl)
          const prevIsBlocklisted = isBlocklistedHost(prevHost)

          const suspect =
            forceAll ||
            !prevUrl ||
            prevIsBlocklisted ||
            prevScore.confidence === "none" ||
            (includeLow && prevScore.confidence === "low")

          if (!suspect) {
            report.skipped_not_suspect += 1
            return
          }

          const discovered = await discoverCareersUrl({
            domain,
            probe: ({ url, signal }) => probeUrl(url, signal),
            maxAttempts: 6,
          })

          if (discovered.confidence === "none" || discovered.confidence === "low") {
            report.discovered_none += 1
            return
          }

          const prevRank = prevIsBlocklisted ? 0 : confidenceRank(prevScore.confidence)
          const nextRank = confidenceRank(discovered.confidence)
          if (nextRank <= prevRank || discovered.url === prevUrl) {
            report.discovered_not_better += 1
            return
          }

          const ats = detectAtsFromUrl(discovered.url)
          report.candidates.push({
            company_id: company.id,
            name: company.name,
            domain,
            prev_url: prevUrl,
            prev_confidence: prevIsBlocklisted ? "none" : prevScore.confidence,
            next_url: discovered.url,
            next_confidence: discovered.confidence,
            reason: discovered.reason,
            next_ats_type: ats?.atsType ?? null,
            next_ats_identifier: ats?.atsIdentifier ?? null,
          })
        })
      )
    )

    console.log(`[trending-repair] scanned=${report.scanned} candidates=${report.candidates.length}`)
    console.log(
      `[trending-repair] skipped: no_domain=${report.skipped_no_domain} not_suspect=${report.skipped_not_suspect} no_discovery=${report.discovered_none} not_better=${report.discovered_not_better}`
    )

    if (report.candidates.length > 0) {
      console.log("[trending-repair] sample:")
      for (const row of report.candidates.slice(0, 20)) {
        console.log(
          `  ${row.domain.padEnd(24)} [${row.prev_confidence} -> ${row.next_confidence}] ${row.prev_url || "(none)"} -> ${row.next_url} (${row.reason})`
        )
      }
    }

    if (execute) {
      for (const row of report.candidates) {
        await pool.query(
          `UPDATE companies
           SET careers_url = $1,
               ats_type = COALESCE($2, ats_type),
               ats_identifier = COALESCE($3, ats_identifier),
               updated_at = NOW()
           WHERE id = $4`,
          [row.next_url, row.next_ats_type, row.next_ats_identifier, row.company_id]
        )
        report.applied += 1
      }
      console.log(`[trending-repair] applied=${report.applied}`)
    }

    writeReport(report)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("[trending-repair] failed", error)
  process.exit(1)
})
