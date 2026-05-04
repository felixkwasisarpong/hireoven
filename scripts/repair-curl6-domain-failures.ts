import { loadEnvConfig } from "@next/env"
import { readFileSync, writeFileSync } from "node:fs"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { parse } from "csv-parse/sync"
import pLimit from "p-limit"
import { Pool } from "pg"
import { discoverCareersUrl, type DiscoveryProbe } from "@/lib/companies/careers-url-discovery"
import { isAtsDomain } from "@/lib/companies/ats-domains"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

loadEnvConfig(process.cwd())

const execFileAsync = promisify(execFile)

const execute = process.argv.includes("--execute")
const includeSubdomains = process.argv.includes("--include-subdomains")
const allowFallback = process.argv.includes("--allow-fallback")
const reasonCodeArg = process.argv.find((arg) => arg.startsWith("--reason-code="))
const reasonCode = Number.parseInt(reasonCodeArg?.split("=")[1] ?? "6", 10)
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = limitArg ? Math.max(1, Number.parseInt(limitArg.split("=")[1], 10)) : null
const inputPath =
  process.argv.find((arg) => arg.startsWith("--input="))?.split("=")[1] ??
  "scripts/output/zero-job-fetch-failures-2026-04-29.csv"
const outputPath =
  process.argv.find((arg) => arg.startsWith("--output="))?.split("=")[1] ??
  "scripts/output/fetch-curl6-domain-repairs-2026-04-29.csv"
const concurrency = Math.max(
  1,
  Number.parseInt(process.env.CRAWLER_AUDIT_CONCURRENCY ?? "8", 10)
)

const ACCEPTABLE_STATUSES = new Set([200, 201, 202, 203, 204, 301, 302, 303, 307, 308, 403, 406, 429])

const LEGAL_SUFFIX_RE =
  /\b(incorporated|inc|l\.?l\.?c\.?|llp|lp|corp|corporation|ltd|limited|co|company|plc|holdings|holding|group|technologies|technology|solutions|services|systems|consulting|consultants|partners|us|usa|america|americas|north\s+america|na|d\s*b\s*a|aka|and)\b\.?/gi

type CsvRow = {
  id: string
  name: string
  domain: string
  ats_type: string
  careers_url: string
  outcome_status: string
  outcome_reason: string
  http_status: string
}

type CompanyMeta = {
  id: string
  name: string
  domain: string | null
  ats_type: string | null
  raw_ats_config: {
    guessed_domain?: string | null
    domain_verified?: boolean
  } | null
}

type ProbeResult = {
  status: number | null
  body: string
  curlError: string | null
}

type Repair = {
  id: string
  name: string
  old_domain: string
  new_domain: string
  old_url: string
  new_url: string
  strategy: string
  confidence: string
  probe_status: string
  probe_reason: string
}

function normalizeDomain(raw: string | null | undefined): string {
  return (raw ?? "")
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]!
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

function parseCsv(path: string): CsvRow[] {
  const raw = readFileSync(path, "utf8")
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as CsvRow[]
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
  if (probe.status === null) return { ok: false, status: null, html: null }
  if (probe.status === 404 || probe.status >= 500) return { ok: false, status: probe.status, html: null }
  return { ok: true, status: probe.status, html: probe.body || "" }
}

function rankStatus(status: number): number {
  if (status >= 200 && status < 300) return 3
  if (status >= 300 && status < 400) return 2
  return 1
}

function rankConfidence(confidence: string): number {
  switch (confidence) {
    case "high":
      return 3
    case "medium":
      return 2
    default:
      return 1
  }
}

function buildNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2)
}

function guessCandidateDomains(name: string): string[] {
  const words = buildNameTokens(name)
  if (words.length === 0) return []

  const seen = new Set<string>()
  const out: string[] = []
  const add = (label: string | null, tlds: string[] = ["com"]) => {
    if (!label || label.length < 3) return
    for (const tld of tlds) {
      const domain = `${label}.${tld}`
      if (seen.has(domain)) continue
      seen.add(domain)
      out.push(domain)
    }
  }

  add(words.join(""))
  if (words.length > 1) add(words.slice(0, 2).join(""))
  if (words.length > 2) add(words.slice(0, 3).join(""))
  if (words.length > 1 && words[0]!.length >= 4) add(words[0]!)

  const acronym = words.map((w) => w[0]).join("")
  if (acronym.length >= 4 && acronym.length <= 6) add(acronym)

  add(words.join(""), ["io", "co", "ai"])
  return out.slice(0, 10)
}

function isDomainPlausible(companyName: string, domain: string): boolean {
  const root = normalizeDomain(domain).split(".")[0] ?? ""
  if (!root) return false

  const tokens = buildNameTokens(companyName).filter((t) => t.length >= 3)
  const collapsed = tokens.join("")

  for (const token of tokens) {
    if (token.length >= 4 && root.includes(token)) return true
  }
  if (root.length >= 4 && collapsed.includes(root)) return true

  const acronym = tokens.map((t) => t[0]).join("")
  if (root.length >= 4 && root.length <= 6 && acronym === root) return true

  return false
}

function isStrongDomainMatch(companyName: string, domain: string): boolean {
  const root = normalizeDomain(domain).split(".")[0] ?? ""
  const tokens = buildNameTokens(companyName).filter((t) => t.length >= 3)
  if (!root || tokens.length === 0) return false

  const longMatches = tokens.filter((t) => t.length >= 4 && root.includes(t))
  if (longMatches.length >= 2) return true

  const firstTwo = tokens.slice(0, 2).join("")
  if (firstTwo.length >= 6 && root.includes(firstTwo)) return true

  if (tokens.length >= 3 && root === tokens[0]) return false
  if (tokens.length === 1 && root.includes(tokens[0]!)) return true

  return longMatches.length >= 1 && root.length >= 8
}

function extractUnresolvedHost(reason: string): string | null {
  const match = reason.match(/Could not resolve host:\s*([^\s]+)/i)
  return match?.[1]?.toLowerCase() ?? null
}

function hasCurlReasonCode(reason: string, code: number): boolean {
  const match = reason.match(/curl:\s*\((\d+)\)/i)
  if (!match?.[1]) return false
  return Number.parseInt(match[1], 10) === code
}

function buildFallbackUrls(domain: string): string[] {
  return [
    `https://${domain}/careers`,
    `https://${domain}/jobs`,
    `https://${domain}/careers/jobs`,
    `https://${domain}/about/careers`,
    `https://${domain}/about/jobs`,
  ]
}

function candidateDomains(row: CsvRow, meta: CompanyMeta | undefined): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (raw: string | null | undefined) => {
    const domain = normalizeDomain(raw)
    if (!domain || !domain.includes(".")) return
    if (isAtsDomain(domain)) return
    if (seen.has(domain)) return
    seen.add(domain)
    out.push(domain)
  }

  add(row.domain)
  const unresolved = extractUnresolvedHost(row.outcome_reason)
  add(unresolved)
  add(meta?.raw_ats_config?.guessed_domain)
  add(meta?.domain)
  for (const guessed of guessCandidateDomains(row.name)) add(guessed)

  return out
}

async function verifyCandidateUrl(url: string): Promise<{ ok: boolean; status: number | null }> {
  const probe = await fetchViaCurl(url)
  if (probe.curlError || probe.status === null) return { ok: false, status: null }
  return { ok: ACCEPTABLE_STATUSES.has(probe.status), status: probe.status }
}

async function chooseRepair(row: CsvRow, meta: CompanyMeta | undefined): Promise<Repair | null> {
  const candidates = candidateDomains(row, meta)
  let best: {
    newDomain: string
    newUrl: string
    strategy: string
    confidence: string
    status: number
    reason: string
    sortScore: number
  } | null = null

  for (const domain of candidates) {
    const guessedDomain = normalizeDomain(meta?.raw_ats_config?.guessed_domain)
    if (
      !isDomainPlausible(row.name, domain) &&
      domain !== guessedDomain
    ) {
      continue
    }
    if (
      domain !== guessedDomain &&
      !isStrongDomainMatch(row.name, domain)
    ) {
      continue
    }

    const discovered = await discoverCareersUrl({
      domain,
      probe: curlProbe,
      maxAttempts: 10,
    })

    if ((discovered.confidence === "high" || discovered.confidence === "medium") && discovered.url) {
      const verify = await verifyCandidateUrl(discovered.url)
      if (verify.ok && verify.status !== null) {
        const score = rankConfidence(discovered.confidence) * 100 + rankStatus(verify.status)
        if (!best || score > best.sortScore) {
          best = {
            newDomain: domain,
            newUrl: discovered.url,
            strategy: `discover_${discovered.confidence}`,
            confidence: discovered.confidence,
            status: verify.status,
            reason: discovered.reason,
            sortScore: score,
          }
          if (discovered.confidence === "high" && verify.status >= 200 && verify.status < 300) {
            break
          }
        }
      }
    }

    if (allowFallback) {
      for (const fallback of buildFallbackUrls(domain)) {
        const verify = await verifyCandidateUrl(fallback)
        if (!verify.ok || verify.status === null) continue
        const score = 100 + rankStatus(verify.status)
        if (!best || score > best.sortScore) {
          best = {
            newDomain: domain,
            newUrl: fallback,
            strategy: "fallback_probe",
            confidence: "low",
            status: verify.status,
            reason: `fallback_status_${verify.status}`,
            sortScore: score,
          }
        }
        if (verify.status >= 200 && verify.status < 300) break
      }
    }
  }

  if (!best) return null
  if (best.newUrl === row.careers_url && best.newDomain === normalizeDomain(row.domain)) return null

  return {
    id: row.id,
    name: row.name,
    old_domain: normalizeDomain(row.domain),
    new_domain: best.newDomain,
    old_url: row.careers_url,
    new_url: best.newUrl,
    strategy: best.strategy,
    confidence: best.confidence,
    probe_status: String(best.status),
    probe_reason: best.reason,
  }
}

function writeOutput(path: string, rows: Repair[]) {
  const headers = [
    "id",
    "name",
    "old_domain",
    "new_domain",
    "old_url",
    "new_url",
    "strategy",
    "confidence",
    "probe_status",
    "probe_reason",
  ]
  const lines = [headers.map(csvEscape).join(",")]
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.name,
        row.old_domain,
        row.new_domain,
        row.old_url,
        row.new_url,
        row.strategy,
        row.confidence,
        row.probe_status,
        row.probe_reason,
      ]
        .map(csvEscape)
        .join(",")
    )
  }
  writeFileSync(path, `${lines.join("\n")}\n`)
}

async function loadMeta(pool: Pool, ids: string[]): Promise<Map<string, CompanyMeta>> {
  const map = new Map<string, CompanyMeta>()
  if (ids.length === 0) return map

  const { rows } = await pool.query<CompanyMeta>(
    `SELECT id, name, domain, ats_type, raw_ats_config
     FROM companies
     WHERE id = ANY($1::uuid[])`,
    [ids]
  )

  for (const row of rows) map.set(row.id, row)
  return map
}

async function main() {
  const allRows = parseCsv(inputPath)
  let filtered = allRows.filter((row) => {
    const reason = row.outcome_reason ?? ""
    if (!hasCurlReasonCode(reason, reasonCode)) return false
    if (reasonCode === 6) {
      const host = extractUnresolvedHost(reason)
      if (!host) return false
      if (!includeSubdomains && (host.startsWith("careers.") || host.startsWith("jobs."))) return false
    }
    return true
  })

  if (limit) filtered = filtered.slice(0, limit)

  console.log(
    `\n[curl-domain-repair] mode=${execute ? "EXECUTE" : "DRY-RUN"} reasonCode=${reasonCode} rows=${filtered.length} includeSubdomains=${includeSubdomains} allowFallback=${allowFallback}`
  )

  const pool = getPool()
  try {
    const metaById = await loadMeta(pool, filtered.map((row) => row.id))
    const gate = pLimit(concurrency)
    const repairs: Repair[] = []
    let skipped = 0

    await Promise.all(
      filtered.map((row, idx) =>
        gate(async () => {
          const repair = await chooseRepair(row, metaById.get(row.id))
          if (repair) repairs.push(repair)
          else skipped += 1

          if ((idx + 1) % 25 === 0) {
            process.stderr.write(`  processed ${idx + 1}/${filtered.length}\\r`)
          }
        })
      )
    )

    process.stderr.write("\\n")
    repairs.sort((a, b) => a.name.localeCompare(b.name))
    writeOutput(outputPath, repairs)

    const byStrategy = new Map<string, number>()
    for (const row of repairs) {
      byStrategy.set(row.strategy, (byStrategy.get(row.strategy) ?? 0) + 1)
    }

    console.log(`\nRepairs: ${repairs.length}`)
    console.log(`Skipped: ${skipped}`)
    for (const [strategy, count] of [...byStrategy.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${strategy.padEnd(18)} ${count}`)
    }
    console.log(`Output: ${outputPath}`)

    if (!execute) {
      console.log("\nAppend --execute to apply updates.")
      return
    }

    let updated = 0
    let domainUpdated = 0
    let domainConflicts = 0
    for (const row of repairs) {
      const logo = companyLogoUrlFromDomain(row.new_domain)
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM companies WHERE domain = $1 LIMIT 1`,
        [row.new_domain]
      )
      const existingId = existing.rows[0]?.id ?? null
      const canSetDomain = !existingId || existingId === row.id

      if (canSetDomain) {
        await pool.query(
          `UPDATE companies
           SET domain = $1,
               careers_url = $2,
               logo_url = CASE WHEN logo_url IS NULL OR logo_url = '' THEN $3 ELSE logo_url END,
               raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb) || jsonb_build_object('domain_verified', true, 'guessed_domain', $1::text),
               updated_at = NOW()
           WHERE id = $4`,
          [row.new_domain, row.new_url, logo, row.id]
        )
        domainUpdated += 1
      } else {
        await pool.query(
          `UPDATE companies
           SET careers_url = $1,
               raw_ats_config = COALESCE(raw_ats_config, '{}'::jsonb) || jsonb_build_object('guessed_domain', $2::text, 'domain_verified', false),
               updated_at = NOW()
           WHERE id = $3`,
          [row.new_url, row.new_domain, row.id]
        )
        domainConflicts += 1
      }
      updated += 1
    }

    console.log(`\nUpdated ${updated} companies. domainUpdated=${domainUpdated} domainConflicts=${domainConflicts}`)
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("repair-curl6-domain-failures failed:", error)
  process.exit(1)
})
