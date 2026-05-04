/**
 * Curl-based failure-mode audit for active zero-job companies.
 *
 * Avoids Node fetch/undici abort edge-cases and classifies:
 * - blocked (403/406/429 or anti-bot body signatures)
 * - fetch_error (curl timeout/network/connection errors)
 * - bad_url (404)
 * - unchanged (HTTP 2xx/3xx but no strong block signal)
 *
 * Usage:
 *   npx tsx scripts/audit-zero-job-http-failures.ts --limit=1031 --csv
 *   npx tsx scripts/audit-zero-job-http-failures.ts --limit=1031 --only-fetch --csv
 */

import { loadEnvConfig } from "@next/env"
import pLimit from "p-limit"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { Pool } from "pg"

loadEnvConfig(process.cwd())

const execFileAsync = promisify(execFile)

const csvOnly = process.argv.includes("--csv")
const onlyFetch = process.argv.includes("--only-fetch")
const onlyBlocked = process.argv.includes("--only-blocked")
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="))
const limit = Math.max(1, Number.parseInt(limitArg?.split("=")[1] ?? "500", 10))
const concurrency = Math.max(1, Number.parseInt(process.env.CRAWLER_AUDIT_CONCURRENCY ?? "12", 10))

type CompanyRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string | null
  ats_type: string | null
}

type OutcomeRow = {
  id: string
  name: string
  domain: string | null
  careers_url: string
  ats_type: string | null
  outcome_status: "blocked" | "fetch_error" | "bad_url" | "unchanged"
  outcome_reason: string
  http_status: number | null
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

function csvEscape(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`
}

function compactReason(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function classifyBodyBlocked(body: string) {
  const text = body.toLowerCase()
  if (text.includes("access denied")) return "blocked_html_access_denied"
  if (text.includes("request blocked")) return "blocked_html_request_blocked"
  if (text.includes("attention required")) return "blocked_html_attention_required"
  if (text.includes("cloudflare")) return "blocked_html_cloudflare"
  if (text.includes("akamai")) return "blocked_html_akamai"
  if (text.includes("incapsula")) return "blocked_html_incapsula"
  if (text.includes("perimeterx")) return "blocked_html_perimeterx"
  return null
}

async function fetchViaCurl(url: string): Promise<{ status: number | null; body: string; curlError: string | null }> {
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
    const stderr = (err.stderr ?? err.message ?? "curl_error").toString().trim()
    return { status: null, body: "", curlError: stderr || "curl_error" }
  }
}

async function main() {
  const pool = getPool()
  try {
    const { rows } = await pool.query<CompanyRow>(
      `SELECT id, name, domain, careers_url, ats_type
       FROM companies
       WHERE is_active = true
         AND COALESCE(job_count, 0) = 0
         AND careers_url IS NOT NULL
         AND careers_url <> ''
       ORDER BY last_crawled_at ASC NULLS FIRST, name
       LIMIT $1`,
      [limit]
    )

    const gate = pLimit(concurrency)
    const outcomes: OutcomeRow[] = []

    await Promise.all(
      rows.map((company, idx) =>
        gate(async () => {
          const url = company.careers_url ?? ""
          const probe = await fetchViaCurl(url)

          let outcome_status: OutcomeRow["outcome_status"] = "unchanged"
          let outcome_reason = "http_ok"

          if (probe.curlError) {
            outcome_status = "fetch_error"
            outcome_reason = compactReason(probe.curlError).slice(0, 180)
          } else if (probe.status === 404) {
            outcome_status = "bad_url"
            outcome_reason = "not_found_404"
          } else if (probe.status === 403) {
            outcome_status = "blocked"
            outcome_reason = "blocked_403"
          } else if (probe.status === 406) {
            outcome_status = "blocked"
            outcome_reason = "blocked_406"
          } else if (probe.status === 429) {
            outcome_status = "blocked"
            outcome_reason = "rate_limited_429"
          } else if (probe.status !== null && probe.status >= 500) {
            outcome_status = "fetch_error"
            outcome_reason = `server_${probe.status}`
          } else {
            const blockedByBody = classifyBodyBlocked(probe.body)
            if (blockedByBody) {
              outcome_status = "blocked"
              outcome_reason = blockedByBody
            }
          }

          outcomes.push({
            id: company.id,
            name: company.name,
            domain: company.domain,
            careers_url: url,
            ats_type: company.ats_type,
            outcome_status,
            outcome_reason,
            http_status: probe.status,
          })

          if ((idx + 1) % 50 === 0) {
            process.stderr.write(`  scanned ${idx + 1}/${rows.length}\\r`)
          }
        })
      )
    )

    process.stderr.write("\\n")
    outcomes.sort((a, b) => a.name.localeCompare(b.name))

    const filtered = onlyFetch
      ? outcomes.filter((row) => row.outcome_status === "fetch_error")
      : onlyBlocked
        ? outcomes.filter((row) => row.outcome_status === "blocked")
        : outcomes

    if (csvOnly) {
      console.log(
        [
          "id",
          "name",
          "domain",
          "ats_type",
          "careers_url",
          "outcome_status",
          "outcome_reason",
          "http_status",
        ]
          .map(csvEscape)
          .join(",")
      )
      for (const row of filtered) {
        console.log(
          [
            row.id,
            row.name,
            row.domain,
            row.ats_type,
            row.careers_url,
            row.outcome_status,
            row.outcome_reason,
            row.http_status,
          ]
            .map(csvEscape)
            .join(",")
        )
      }
      return
    }

    const byStatus = new Map<string, number>()
    for (const row of outcomes) {
      byStatus.set(row.outcome_status, (byStatus.get(row.outcome_status) ?? 0) + 1)
    }

    console.log(`\\nAudit sample size: ${outcomes.length}`)
    for (const [status, count] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status.padEnd(12)} ${count}`)
    }

    if (onlyFetch) {
      console.log(`\\nFetch-error rows: ${filtered.length}`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error("audit-zero-job-http-failures failed:", error)
  process.exit(1)
})
