/**
 * Apply crawl-ready company URL/ATS updates from a cleaned CSV, then run a full
 * crawl for the matched zero-job set, and export faulty outcomes.
 *
 * Usage:
 *   npx tsx scripts/apply-and-crawl-cleaned-companies.ts
 *   npx tsx scripts/apply-and-crawl-cleaned-companies.ts --execute
 *   npx tsx scripts/apply-and-crawl-cleaned-companies.ts --execute --concurrency=8
 *   npx tsx scripts/apply-and-crawl-cleaned-companies.ts --execute --input=scripts/output/careers-cleaned-crawl-ready-combined-2026-04-30.csv
 */

import { loadEnvConfig } from "@next/env"
import fs from "node:fs"
import path from "node:path"
import pLimit from "p-limit"
import { parse } from "csv-parse/sync"
import { Pool } from "pg"
import { crawlCareersPage } from "@/lib/crawler"
import { persistCrawlJobs } from "@/lib/crawler/persist"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"

loadEnvConfig(process.cwd())

type InputRow = {
  name: string
  careers_url: string
  ats_type: string
  source_status?: string
  notes?: string
  triage_source?: string
}

type CompanyRow = {
  id: string
  name: string
  job_count: number | null
  careers_url: string | null
  ats_type: string | null
  ats_identifier: string | null
  last_crawled_at: string | null
}

type TargetRow = {
  inputName: string
  company: CompanyRow
  careersUrl: string
  nextAtsType: string | null
  nextAtsIdentifier: string | null
  changedUrl: boolean
  changedAtsType: boolean
}

type CrawlOutcome = {
  id: string
  name: string
  careers_url: string
  ats_type: string | null
  outcome_status: "success" | "empty" | "blocked" | "bad_url" | "fetch_error" | "error"
  outcome_reason: string
  jobs_found: number
  inserted: number
  updated: number
  active_count: number
}

const execute = process.argv.includes("--execute")
const inputArg = process.argv.find((arg) => arg.startsWith("--input="))
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="))
const includeNonZero = process.argv.includes("--include-nonzero")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))

const concurrency = Math.max(
  1,
  Number.parseInt(concurrencyArg?.split("=")[1] ?? "4", 10)
)
const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.split("=")[1], 10)) : null

const defaultInput = "scripts/output/careers-cleaned-crawl-ready-combined-2026-04-30.csv"
const defaultVerifiedInput = "scripts/output/careers-cleaned-verified-crawl-ready-2026-04-30.csv"
const defaultProbeInput = "scripts/output/careers-cleaned-probe-results-2026-04-30.csv"
const inputPath = inputArg?.split("=")[1] ?? defaultInput

const NAME_ALIASES: Record<string, string> = {
  Abbott: "Abbott Laboratories",
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

function normalizeAtsType(value: string | null | undefined): string | null {
  const v = String(value ?? "").trim().toLowerCase()
  if (!v || v === "unknown" || v === "null" || v === "none") return null
  return v
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

function fileDateStamp() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, "0")
  const d = String(now.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function readInputRows(csvPath: string): InputRow[] {
  const abs = path.resolve(csvPath)
  if (!fs.existsSync(abs)) {
    throw new Error(`Input file not found: ${abs}`)
  }
  const raw = fs.readFileSync(abs, "utf8")
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as InputRow[]
  return rows.filter((row) => row.name && row.careers_url)
}

function readCanonicalCompositeRows(): InputRow[] {
  const verifiedRaw = fs.readFileSync(path.resolve(defaultVerifiedInput), "utf8")
  const probeRaw = fs.readFileSync(path.resolve(defaultProbeInput), "utf8")

  const verified = parse(verifiedRaw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Array<Record<string, string>>

  const probe = parse(probeRaw, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Array<Record<string, string>>

  const rows: InputRow[] = []

  for (const row of verified) {
    const name = String(row.name ?? "").trim()
    const careersUrl = String(row.careers_url ?? "").trim()
    if (!name || !careersUrl) continue
    rows.push({
      name,
      careers_url: careersUrl,
      ats_type: String(row.ats_type ?? "unknown").trim() || "unknown",
      source_status: String(row.status ?? "verified").trim(),
      notes: String(row.notes ?? "").trim(),
      triage_source: "verified",
    })
  }

  for (const row of probe) {
    if (String(row.recommendation ?? "").trim() !== "keep_and_crawl") continue
    const name = String(row.name ?? "").trim()
    const careersUrl = String(row.final_url ?? row.original_url ?? "").trim()
    if (!name || !careersUrl) continue

    const detectedType = String(row.detected_ats_type ?? "").trim()
    const originalType = String(row.original_ats_type ?? "").trim()
    const atsType = detectedType || originalType || "unknown"

    rows.push({
      name,
      careers_url: careersUrl,
      ats_type: atsType,
      source_status: String(row.status ?? "").trim(),
      notes: String(row.notes ?? "").trim(),
      triage_source: "probe_keep_and_crawl",
    })
  }

  const dedup = new Map<string, InputRow>()
  for (const row of rows) dedup.set(row.name, row)
  return [...dedup.values()]
}

function buildTargets(inputs: InputRow[], companies: CompanyRow[]): {
  targets: TargetRow[]
  unmatched: string[]
  skippedNonZero: string[]
} {
  const byName = new Map<string, CompanyRow>()
  for (const company of companies) {
    byName.set(company.name.trim(), company)
  }

  const targets: TargetRow[] = []
  const unmatched: string[] = []
  const skippedNonZero: string[] = []

  for (const row of inputs) {
    const inputName = row.name.trim()
    const resolvedName = NAME_ALIASES[inputName] ?? inputName
    const company = byName.get(resolvedName)

    if (!company) {
      unmatched.push(inputName)
      continue
    }

    if (!includeNonZero && (company.job_count ?? 0) > 0) {
      skippedNonZero.push(inputName)
      continue
    }

    const careersUrl = row.careers_url.trim()
    const existingAtsType = normalizeAtsType(company.ats_type)
    const parsedAtsType = normalizeAtsType(row.ats_type)
    const detected = detectAtsFromUrl(careersUrl)

    const nextAtsType = parsedAtsType ?? existingAtsType
    const nextAtsIdentifier =
      detected && nextAtsType && detected.atsType === nextAtsType
        ? detected.atsIdentifier
        : null

    targets.push({
      inputName,
      company,
      careersUrl,
      nextAtsType,
      nextAtsIdentifier,
      changedUrl: (company.careers_url ?? "") !== careersUrl,
      changedAtsType: (existingAtsType ?? "") !== (nextAtsType ?? ""),
    })
  }

  return { targets, unmatched, skippedNonZero }
}

async function main() {
  const pool = getPool()
  const mode = execute ? "EXECUTE" : "DRY-RUN"
  console.log(
    `\n[apply-and-crawl-cleaned] mode=${mode} input=${inputPath} concurrency=${concurrency}${includeNonZero ? " includeNonZero=true" : ""}${limit ? ` limit=${limit}` : ""}`
  )

  try {
    let inputs = readInputRows(inputPath)
    if (inputPath === defaultInput && inputs.length < 810) {
      console.log(
        `\nInput appears truncated (${inputs.length} rows). Rebuilding canonical set from verified + probe keep rows...`
      )
      inputs = readCanonicalCompositeRows()
      console.log(`Canonical rebuilt rows: ${inputs.length}`)
    }
    const { rows: companies } = await pool.query<CompanyRow>(
      `SELECT id, name, job_count, careers_url, ats_type, ats_identifier, last_crawled_at
       FROM companies
       WHERE is_active = true`
    )

    const { targets, unmatched, skippedNonZero } = buildTargets(inputs, companies)
    const boundedTargets = limit ? targets.slice(0, limit) : targets

    const urlChanges = boundedTargets.filter((t) => t.changedUrl).length
    const atsChanges = boundedTargets.filter((t) => t.changedAtsType).length

    console.log(`\nInput rows: ${inputs.length}`)
    console.log(`Matched targets: ${boundedTargets.length}`)
    console.log(`Unmatched names: ${unmatched.length}`)
    console.log(`Skipped non-zero companies: ${skippedNonZero.length}`)
    console.log(`URL changes: ${urlChanges}`)
    console.log(`ATS-type changes: ${atsChanges}`)

    if (unmatched.length > 0) {
      console.log("\nUnmatched sample:")
      for (const name of unmatched.slice(0, 20)) {
        console.log(`  - ${name}`)
      }
    }

    if (!execute) {
      console.log("\nDry-run only. Append --execute to apply and crawl.")
      return
    }

    // Apply URL/ATS updates first.
    let applied = 0
    for (const target of boundedTargets) {
      await pool.query(
        `UPDATE companies
         SET careers_url = $1,
             ats_type = COALESCE($2, ats_type),
             ats_identifier = COALESCE($3, ats_identifier),
             updated_at = NOW()
         WHERE id = $4`,
        [
          target.careersUrl,
          target.nextAtsType,
          target.nextAtsIdentifier,
          target.company.id,
        ]
      )
      applied += 1
    }
    console.log(`\nApplied updates: ${applied}`)

    // Crawl full matched set.
    const gate = pLimit(concurrency)
    const outcomes: CrawlOutcome[] = []

    let completed = 0
    await Promise.all(
      boundedTargets.map((target) =>
        gate(async () => {
          try {
            const crawled = await crawlCareersPage({
              id: target.company.id,
              companyName: target.company.name,
              careersUrl: target.careersUrl,
              lastCrawledAt: target.company.last_crawled_at
                ? new Date(target.company.last_crawled_at)
                : null,
              atsType: target.nextAtsType ?? target.company.ats_type,
              atsIdentifier: target.nextAtsIdentifier ?? target.company.ats_identifier,
            })

            const persisted = await persistCrawlJobs({
              companyId: target.company.id,
              crawledAt: crawled.crawledAt,
              jobs: crawled.jobs,
              sourceUrl: crawled.url,
              normalizedUrl: crawled.normalizedUrl,
              diagnostics: crawled.diagnostics,
            })

            outcomes.push({
              id: target.company.id,
              name: target.company.name,
              careers_url: target.careersUrl,
              ats_type: target.nextAtsType ?? target.company.ats_type,
              outcome_status: crawled.outcomeStatus ?? (crawled.jobs.length > 0 ? "success" : "empty"),
              outcome_reason: crawled.outcomeReason ?? (crawled.jobs.length > 0 ? "success" : "empty_job_list"),
              jobs_found: crawled.jobs.length,
              inserted: persisted.inserted,
              updated: persisted.updated,
              active_count: persisted.activeCount,
            })
          } catch (error) {
            outcomes.push({
              id: target.company.id,
              name: target.company.name,
              careers_url: target.careersUrl,
              ats_type: target.nextAtsType ?? target.company.ats_type,
              outcome_status: "error",
              outcome_reason:
                error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
              jobs_found: 0,
              inserted: 0,
              updated: 0,
              active_count: 0,
            })
          } finally {
            completed += 1
            if (completed % 20 === 0 || completed === boundedTargets.length) {
              process.stdout.write(`  crawled ${completed}/${boundedTargets.length}\r`)
            }
          }
        })
      )
    )
    process.stdout.write("\n")

    outcomes.sort((a, b) => a.name.localeCompare(b.name))

    const success = outcomes.filter((o) => o.jobs_found > 0).length
    const faulty = outcomes.filter((o) => o.jobs_found === 0)

    const dateStamp = fileDateStamp()
    const outDir = path.resolve("scripts/output")
    fs.mkdirSync(outDir, { recursive: true })

    const allPath = path.join(
      outDir,
      `careers-cleaned-full-crawl-results-${dateStamp}.csv`
    )
    const faultyPath = path.join(
      outDir,
      `careers-cleaned-full-crawl-faulty-${dateStamp}.csv`
    )

    const header = [
      "id",
      "name",
      "careers_url",
      "ats_type",
      "outcome_status",
      "outcome_reason",
      "jobs_found",
      "inserted",
      "updated",
      "active_count",
    ]

    const renderCsv = (rows: CrawlOutcome[]) =>
      [header.map(csvEscape).join(",")]
        .concat(
          rows.map((row) =>
            [
              row.id,
              row.name,
              row.careers_url,
              row.ats_type,
              row.outcome_status,
              row.outcome_reason,
              row.jobs_found,
              row.inserted,
              row.updated,
              row.active_count,
            ]
              .map(csvEscape)
              .join(",")
          )
        )
        .join("\n")

    fs.writeFileSync(allPath, renderCsv(outcomes))
    fs.writeFileSync(faultyPath, renderCsv(faulty))

    console.log(`\nCrawl complete.`)
    console.log(`  Total crawled: ${outcomes.length}`)
    console.log(`  Success (jobs_found > 0): ${success}`)
    console.log(`  Faulty (jobs_found = 0): ${faulty.length}`)
    console.log(`  Results CSV: ${allPath}`)
    console.log(`  Faulty CSV:  ${faultyPath}`)

    const byStatus = new Map<string, number>()
    for (const row of faulty) {
      byStatus.set(row.outcome_status, (byStatus.get(row.outcome_status) ?? 0) + 1)
    }
    if (faulty.length > 0) {
      console.log("\nFaulty by outcome_status:")
      for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${status.padEnd(12)} ${count}`)
      }
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("apply-and-crawl-cleaned-companies failed:", error)
  process.exit(1)
})
