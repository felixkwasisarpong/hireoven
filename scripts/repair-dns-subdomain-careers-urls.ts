import { loadEnvConfig } from "@next/env"
import { readFileSync, writeFileSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parse } from "csv-parse/sync"
import pLimit from "p-limit"
import { Pool } from "pg"
import { discoverCareersUrl, type DiscoveryProbe } from "@/lib/companies/careers-url-discovery"

loadEnvConfig(process.cwd())

const execFileAsync = promisify(execFile)

const execute = process.argv.includes("--execute")
const includeNoMatch = process.argv.includes("--include-no-match")
const inputPath =
  process.argv.find((arg) => arg.startsWith("--input="))?.split("=")[1] ??
  "scripts/output/fetch-dns-subdomain-misses-2026-04-29.csv"
const outputPath =
  process.argv.find((arg) => arg.startsWith("--output="))?.split("=")[1] ??
  "scripts/output/fetch-dns-subdomain-repairs-2026-04-29.csv"
const concurrency = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_AUDIT_CONCURRENCY ?? "8", 10)
)

const ACCEPTABLE_STATUSES = new Set([200, 201, 202, 203, 204, 301, 302, 303, 307, 308, 403, 406, 429])

type InputRow = {
  id: string
  name: string
  domain: string
  ats_type: string
  careers_url: string
  outcome_status: string
  outcome_reason: string
  http_status: string
  unresolved_host: string
  base_domain: string
  matches_company_domain: string
}

type ProbeResult = {
  status: number | null
  body: string
  curlError: string | null
}

type RepairRow = {
  id: string
  name: string
  domain: string
  old_url: string
  new_url: string
  strategy: string
  probe_status: string
  probe_reason: string
  ats_type: string
  unresolved_host: string
}

function getPool() {
  const connectionString = process.env.DATABASE_URL ?? process.env.TARGET_POSTGRES_URL
  if (!connectionString) throw new Error("Missing DATABASE_URL or TARGET_POSTGRES_URL")
  return new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
  })
}

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

async function fetchViaCurl(url: string): Promise<ProbeResult> {
  const marker = "__HTTP_STATUS__"
  try {
    const { stdout, stderr } = await execFileAsync(
      "curl",
      [
        "-L",
        "--max-time",
        "12",
        "--connect-timeout",
        "6",
        "-A",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "-H",
        "Accept-Language: en-US,en;q=0.9",
        "-sS",
        "-w",
        `\\n${marker}:%{http_code}\\n`,
        url,
      ],
      { maxBuffer: 2 * 1024 * 1024 }
    )

    const idx = stdout.lastIndexOf(`${marker}:`)
    if (idx === -1) {
      return { status: null, body: stdout, curlError: stderr?.trim() || "curl_no_status" }
    }

    const body = stdout.slice(0, idx)
    const statusRaw = stdout.slice(idx + marker.length + 1).trim()
    const codeNum = Number.parseInt(statusRaw, 10)
    const status = Number.isFinite(codeNum) ? codeNum : null

    return { status, body, curlError: null }
  } catch (error) {
    const err = error as Error & { stderr?: string }
    return {
      status: null,
      body: "",
      curlError: (err.stderr ?? err.message ?? "curl_error").toString().trim() || "curl_error",
    }
  }
}

const curlProbe: DiscoveryProbe = async ({ url }) => {
  const probe = await fetchViaCurl(url)
  if (probe.curlError) return { ok: false, status: null, html: null }
  const status = probe.status
  if (status === null) return { ok: false, status: null, html: null }
  if (status >= 500) return { ok: false, status, html: null }
  if (status === 404) return { ok: false, status, html: null }
  return { ok: true, status, html: probe.body || "" }
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^www\./, "")
}

function buildFallbackCandidates(domain: string, unresolvedHost: string): string[] {
  const normalized = normalizeDomain(domain)
  const originalPrefix = unresolvedHost.toLowerCase().startsWith("jobs.") ? "jobs" : "careers"
  const paths =
    originalPrefix === "jobs"
      ? ["/jobs", "/careers", "/careers/jobs", "/about/careers", "/about/jobs"]
      : ["/careers", "/jobs", "/careers/jobs", "/about/careers", "/about/jobs"]
  return paths.map((path) => `https://${normalized}${path}`)
}

function parseInput(path: string): InputRow[] {
  const raw = readFileSync(path, "utf8")
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as InputRow[]
}

function writeOutput(path: string, rows: RepairRow[]) {
  const headers = [
    "id",
    "name",
    "domain",
    "old_url",
    "new_url",
    "strategy",
    "probe_status",
    "probe_reason",
    "ats_type",
    "unresolved_host",
  ]
  const lines = [headers.map(csvEscape).join(",")]
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.name,
        row.domain,
        row.old_url,
        row.new_url,
        row.strategy,
        row.probe_status,
        row.probe_reason,
        row.ats_type,
        row.unresolved_host,
      ]
        .map(csvEscape)
        .join(",")
    )
  }
  writeFileSync(path, `${lines.join("\n")}\n`)
}

async function chooseFallback(urls: string[]): Promise<{ url: string; status: number; reason: string } | null> {
  let best: { url: string; status: number; reason: string; rank: number } | null = null

  for (const url of urls) {
    const probe = await fetchViaCurl(url)
    if (probe.curlError || probe.status === null) continue
    if (!ACCEPTABLE_STATUSES.has(probe.status)) continue

    const rank = probe.status >= 200 && probe.status < 400 ? 2 : 1
    if (!best || rank > best.rank) {
      best = {
        url,
        status: probe.status,
        reason: `fallback_status_${probe.status}`,
        rank,
      }
      if (rank === 2) break
    }
  }

  if (!best) return null
  return { url: best.url, status: best.status, reason: best.reason }
}

async function main() {
  const rows = parseInput(inputPath)
  const filtered = rows.filter((row) =>
    includeNoMatch ? true : String(row.matches_company_domain ?? "").toLowerCase() === "yes"
  )

  console.log(
    `\n[dns-subdomain-repair] mode=${execute ? "EXECUTE" : "DRY-RUN"} rows=${filtered.length} includeNoMatch=${includeNoMatch}`
  )

  const gate = pLimit(concurrency)
  const repairs: RepairRow[] = []
  let noCandidate = 0

  await Promise.all(
    filtered.map((row, idx) =>
      gate(async () => {
        const domain = normalizeDomain(row.domain || row.base_domain)
        if (!domain) {
          noCandidate += 1
          return
        }

        const discovered = await discoverCareersUrl({
          domain,
          probe: curlProbe,
          maxAttempts: 10,
        })

        let chosen: { url: string; status: number; reason: string; strategy: string } | null = null

        if (
          (discovered.confidence === "high" || discovered.confidence === "medium") &&
          discovered.url &&
          discovered.url !== row.careers_url
        ) {
          const verify = await fetchViaCurl(discovered.url)
          if (!verify.curlError && verify.status !== null && ACCEPTABLE_STATUSES.has(verify.status)) {
            chosen = {
              url: discovered.url,
              status: verify.status,
              reason: discovered.reason,
              strategy: `discover_${discovered.confidence}`,
            }
          }
        }

        if (!chosen) {
          const fallback = await chooseFallback(
            buildFallbackCandidates(domain, row.unresolved_host)
          )
          if (fallback && fallback.url !== row.careers_url) {
            chosen = {
              url: fallback.url,
              status: fallback.status,
              reason: fallback.reason,
              strategy: "fallback_probe",
            }
          }
        }

        if (!chosen) {
          noCandidate += 1
        } else {
          repairs.push({
            id: row.id,
            name: row.name,
            domain,
            old_url: row.careers_url,
            new_url: chosen.url,
            strategy: chosen.strategy,
            probe_status: String(chosen.status),
            probe_reason: chosen.reason,
            ats_type: row.ats_type,
            unresolved_host: row.unresolved_host,
          })
        }

        if ((idx + 1) % 20 === 0) {
          process.stderr.write(`  processed ${idx + 1}/${filtered.length}\\r`)
        }
      })
    )
  )

  process.stderr.write("\\n")
  repairs.sort((a, b) => a.name.localeCompare(b.name))
  writeOutput(outputPath, repairs)

  const strategyCounts = new Map<string, number>()
  for (const row of repairs) {
    strategyCounts.set(row.strategy, (strategyCounts.get(row.strategy) ?? 0) + 1)
  }

  console.log(`\nCandidates: ${repairs.length}`)
  console.log(`No candidate: ${noCandidate}`)
  for (const [strategy, count] of [...strategyCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${strategy.padEnd(18)} ${count}`)
  }
  console.log(`Output: ${outputPath}`)

  if (!execute) {
    console.log("\nAppend --execute to apply updates.")
    return
  }

  const pool = getPool()
  try {
    let updated = 0
    for (const row of repairs) {
      await pool.query(
        `UPDATE companies
         SET careers_url = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [row.new_url, row.id]
      )
      updated += 1
    }
    console.log(`\nUpdated ${updated} companies.`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("repair-dns-subdomain-careers-urls failed:", error)
  process.exit(1)
})
