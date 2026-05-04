import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { Pool } from "pg"
import {
  discoverCareersUrl,
  scoreCareersUrl,
  type CareersUrlConfidence,
} from "@/lib/companies/careers-url-discovery"

loadEnvConfig(process.cwd())

const execute = process.argv.includes("--execute")
const includeLowConfidence = process.argv.includes("--include-low")
const probeTimeoutMs = Math.max(
  1500,
  Number.parseInt(process.env.CAREERS_REPAIR_PROBE_TIMEOUT_MS ?? "3500", 10)
)
const concurrency = Math.max(
  1,
  Number.parseInt(process.env.CAREERS_REPAIR_CONCURRENCY ?? "40", 10)
)
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.split("=")[1], 10)) : null

const BLOCKLIST_HOSTS = ["linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com"]

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
}

type Candidate = {
  company: CompanyRow
  prevUrl: string
  prevConfidence: CareersUrlConfidence
  nextUrl: string
  nextConfidence: CareersUrlConfidence
  reason: string
}

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

async function main() {
  const pool = getPool()
  const mode = execute ? "EXECUTE" : "DRY-RUN"
  console.log(
    `\n[zero-job-careers-repair] mode=${mode} concurrency=${concurrency} includeLow=${includeLowConfidence}${limit ? ` limit=${limit}` : ""}`
  )

  try {
    const { rows } = await pool.query<CompanyRow>(
      `SELECT id, name, domain, careers_url, ats_type
       FROM companies
       WHERE is_active = true
         AND COALESCE(job_count, 0) = 0
       ORDER BY name${limit ? ` LIMIT ${limit}` : ""}`
    )

    const limitFn = pLimit(concurrency)

    let scanned = 0
    let skippedNoDomain = 0
    let skippedNotSuspect = 0
    let discoveredNone = 0
    let discoveredNotBetter = 0
    const candidates: Candidate[] = []

    await Promise.all(
      rows.map((company) =>
        limitFn(async () => {
          scanned += 1
          const domain = company.domain?.trim().toLowerCase().replace(/^www\./, "")
          const prevUrl = (company.careers_url ?? "").trim()

          if (!domain) {
            skippedNoDomain += 1
            return
          }

          const prevScore = scoreCareersUrl(prevUrl)
          const prevHost = hostFromUrl(prevUrl)
          const prevIsBlocklisted = isBlocklistedHost(prevHost)

          const suspect =
            !prevUrl ||
            prevIsBlocklisted ||
            prevScore.confidence === "none" ||
            (includeLowConfidence && prevScore.confidence === "low")

          if (!suspect) {
            skippedNotSuspect += 1
            if (scanned % 100 === 0) {
              process.stdout.write(`  progress: scanned ${scanned}/${rows.length}\r`)
            }
            return
          }

          const discovered = await discoverCareersUrl({
            domain,
            probe: ({ url, signal }) => probeUrl(url, signal),
            maxAttempts: 4,
          })

          if (discovered.confidence === "none" || discovered.confidence === "low") {
            discoveredNone += 1
            return
          }

          const prevRank = prevIsBlocklisted ? 0 : confidenceRank(prevScore.confidence)
          const nextRank = confidenceRank(discovered.confidence)

          if (nextRank <= prevRank || discovered.url === prevUrl) {
            discoveredNotBetter += 1
            return
          }

          candidates.push({
            company,
            prevUrl,
            prevConfidence: prevIsBlocklisted ? "none" : prevScore.confidence,
            nextUrl: discovered.url,
            nextConfidence: discovered.confidence,
            reason: discovered.reason,
          })

          if (scanned % 100 === 0) {
            process.stdout.write(`  progress: scanned ${scanned}/${rows.length}\r`)
          }
        })
      )
    )

    process.stdout.write("\n")

    console.log(`\nScanned: ${scanned}`)
    console.log(`Skipped (no domain): ${skippedNoDomain}`)
    console.log(`Skipped (not suspect): ${skippedNotSuspect}`)
    console.log(`No usable discovery: ${discoveredNone}`)
    console.log(`Discovered but not better: ${discoveredNotBetter}`)
    console.log(`Candidates: ${candidates.length}`)

    if (candidates.length > 0) {
      console.log("\nSample candidates (up to 40):")
      for (const row of candidates.slice(0, 40)) {
        console.log(
          `  ${row.company.name.slice(0, 36).padEnd(36)} [${row.prevConfidence} -> ${row.nextConfidence}]\n` +
            `    ${row.prevUrl || "(none)"}\n` +
            `    -> ${row.nextUrl} (${row.reason})`
        )
      }
    }

    if (!execute) {
      console.log("\nAppend --execute to apply these updates.")
      return
    }

    let updated = 0
    for (const row of candidates) {
      await pool.query(
        `UPDATE companies
         SET careers_url = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [row.nextUrl, row.company.id]
      )
      updated += 1
    }

    console.log(`\nUpdated ${updated} companies.`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("repair-zero-job-careers-urls failed:", error)
  process.exit(1)
})
