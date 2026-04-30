/**
 * Apply patched careers URL fixes from an external CSV (focused on bad_url rows),
 * validating each candidate with HEAD (fallback GET on 405) before persisting.
 *
 * Usage:
 *   npx tsx scripts/apply-failure-url-patches.ts
 *   npx tsx scripts/apply-failure-url-patches.ts --execute
 *   npx tsx scripts/apply-failure-url-patches.ts --input=/Users/Apple/Downloads/careers_failures_patched.csv --execute
 */

import { loadEnvConfig } from "@next/env"
import { execFile } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { promisify } from "node:util"
import { parse } from "csv-parse/sync"
import pLimit from "p-limit"
import { Pool } from "pg"
import { detectAtsFromUrl } from "@/lib/companies/detect-ats"

loadEnvConfig(process.cwd())

const execFileAsync = promisify(execFile)

type PatchRow = {
  id: string
  name: string
  domain: string
  ats_type: string
  careers_url: string
  outcome_status: string
  outcome_reason: string
  http_status: string
  new_careers_url: string
  new_ats_type: string
  correction_confidence: string
  correction_notes: string
}

type ProbeResult = {
  ok: boolean
  status: number | null
  effectiveUrl: string | null
  mode: "head" | "get" | "none"
  error: string | null
}

type Decision = {
  id: string
  name: string
  old_url: string
  new_url: string
  old_ats_type: string
  new_ats_type: string
  confidence: string
  probe_ok: boolean
  probe_status: number | null
  probe_mode: string
  probe_effective_url: string | null
  probe_error: string | null
  decision: string
  notes: string
}

const execute = process.argv.includes("--execute")
const inputArg = process.argv.find((arg) => arg.startsWith("--input="))
const concurrencyArg = process.argv.find((arg) => arg.startsWith("--concurrency="))
const concurrency = Math.max(
  1,
  Number.parseInt(concurrencyArg?.split("=")[1] ?? "10", 10)
)
const inputPath =
  inputArg?.split("=")[1] ?? "/Users/Apple/Downloads/careers_failures_patched.csv"
const forceHighConfidence = !process.argv.includes("--no-force-high")
const strictProbe = process.argv.includes("--strict-probe")

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

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

function statusLooksReachable(status: number | null) {
  if (status === null) return false
  if (status >= 200 && status < 400) return true
  return status === 401 || status === 403 || status === 406 || status === 429
}

function hostnameOf(url: string | null | undefined) {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

async function runCurlProbe(
  url: string,
  mode: "head" | "get"
): Promise<{
  status: number | null
  effectiveUrl: string | null
  error: string | null
}> {
  const marker = "__STATUS_URL__"
  const args = [
    "-L",
    "--max-time",
    "15",
    "--connect-timeout",
    "6",
    "-A",
    USER_AGENT,
    "-H",
    "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "-H",
    "Accept-Language: en-US,en;q=0.9",
    "-H",
    "Accept-Encoding: gzip, deflate, br",
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    `${marker}:%{http_code}|%{url_effective}`,
  ]

  if (mode === "head") args.unshift("-I")
  args.push(url)

  try {
    const { stdout, stderr } = await execFileAsync("curl", args, {
      maxBuffer: 1024 * 1024,
    })
    const idx = stdout.lastIndexOf(`${marker}:`)
    if (idx === -1) {
      return {
        status: null,
        effectiveUrl: null,
        error: (stderr || "curl_no_status").trim(),
      }
    }

    const trailer = stdout.slice(idx + marker.length + 1).trim()
    const [statusRaw, effectiveUrlRaw] = trailer.split("|")
    const statusNum = Number.parseInt(statusRaw ?? "", 10)
    return {
      status: Number.isFinite(statusNum) ? statusNum : null,
      effectiveUrl: effectiveUrlRaw?.trim() || null,
      error: null,
    }
  } catch (error) {
    const err = error as Error & { stderr?: string }
    return {
      status: null,
      effectiveUrl: null,
      error: String(err.stderr ?? err.message ?? "curl_error").trim(),
    }
  }
}

async function probeUrl(url: string): Promise<ProbeResult> {
  const head = await runCurlProbe(url, "head")
  if (head.status === 405) {
    const get = await runCurlProbe(url, "get")
    return {
      ok: statusLooksReachable(get.status),
      status: get.status,
      effectiveUrl: get.effectiveUrl,
      mode: "get",
      error: get.error,
    }
  }

  return {
    ok: statusLooksReachable(head.status),
    status: head.status,
    effectiveUrl: head.effectiveUrl,
    mode: head.status === null ? "none" : "head",
    error: head.error,
  }
}

function dayStamp() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

async function main() {
  const mode = execute ? "EXECUTE" : "DRY-RUN"
  console.log(
    `\n[apply-failure-url-patches] mode=${mode} input=${inputPath} concurrency=${concurrency} forceHigh=${forceHighConfidence} strictProbe=${strictProbe}`
  )

  const absInput = path.resolve(inputPath)
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${absInput}`)
  }

  const parsed = parse(fs.readFileSync(absInput, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as PatchRow[]

  const candidates = parsed.filter((row) => {
    if (String(row.outcome_status).trim() !== "bad_url") return false
    const next = String(row.new_careers_url ?? "").trim()
    if (!next) return false
    return next !== String(row.careers_url ?? "").trim()
  })

  console.log(`Total patched rows: ${parsed.length}`)
  console.log(`bad_url candidates with changed URL: ${candidates.length}`)

  const decisions: Decision[] = []
  const limit = pLimit(concurrency)

  await Promise.all(
    candidates.map((row) =>
      limit(async () => {
        const newUrl = String(row.new_careers_url).trim()
        const confidence = String(row.correction_confidence ?? "").trim().toLowerCase()
        const probe = await probeUrl(newUrl)

        const finalHost = hostnameOf(probe.effectiveUrl ?? newUrl)
        const redirectedToLinkedin = Boolean(
          finalHost &&
            (finalHost.includes("linkedin.com") || finalHost.includes("lnkd.in"))
        )

        let decision = "apply"
        if (redirectedToLinkedin) {
          decision = "skip_linkedin_redirect"
        } else if (strictProbe) {
          if (forceHighConfidence && confidence === "high") {
            decision = "apply"
          } else if (!probe.ok && probe.status === 404) {
            decision = "skip_still_404"
          } else if (!probe.ok) {
            decision = "skip_probe_fail"
          }
        }

        decisions.push({
          id: String(row.id).trim(),
          name: String(row.name).trim(),
          old_url: String(row.careers_url).trim(),
          new_url: newUrl,
          old_ats_type: String(row.ats_type ?? "").trim(),
          new_ats_type: String(row.new_ats_type ?? "").trim(),
          confidence,
          probe_ok: probe.ok,
          probe_status: probe.status,
          probe_mode: probe.mode,
          probe_effective_url: probe.effectiveUrl,
          probe_error: probe.error,
          decision,
          notes: String(row.correction_notes ?? "").trim(),
        })
      })
    )
  )

  decisions.sort((a, b) => a.name.localeCompare(b.name))
  const toApply = decisions.filter((d) => d.decision === "apply")

  console.log(`\nValidated candidates: ${decisions.length}`)
  console.log(`Will apply: ${toApply.length}`)
  console.log(
    `Skipped: ${decisions.length - toApply.length}`
  )

  if (execute && toApply.length > 0) {
    const pool = getPool()
    try {
      for (const row of toApply) {
        const urlDetected = detectAtsFromUrl(row.new_url)
        const nextAtsType = row.new_ats_type || row.old_ats_type || null
        const nextAtsIdentifier =
          urlDetected && nextAtsType && urlDetected.atsType === nextAtsType
            ? urlDetected.atsIdentifier
            : null

        await pool.query(
          `UPDATE companies
           SET careers_url = $1,
               ats_type = COALESCE($2, ats_type),
               ats_identifier = COALESCE($3, ats_identifier),
               updated_at = NOW()
           WHERE id = $4`,
          [row.new_url, nextAtsType, nextAtsIdentifier, row.id]
        )
      }
    } finally {
      await pool.end()
    }
  }

  const outDir = path.resolve("scripts/output")
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = dayStamp()
  const resultsPath = path.join(
    outDir,
    `careers-failure-patch-application-results-${stamp}.csv`
  )
  const summaryPath = path.join(
    outDir,
    `careers-failure-patch-application-summary-${stamp}.txt`
  )

  const header = [
    "id",
    "name",
    "old_url",
    "new_url",
    "old_ats_type",
    "new_ats_type",
    "confidence",
    "probe_ok",
    "probe_status",
    "probe_mode",
    "probe_effective_url",
    "probe_error",
    "decision",
    "notes",
  ]

  const csv = [header.map(csvEscape).join(",")]
    .concat(
      decisions.map((row) =>
        [
          row.id,
          row.name,
          row.old_url,
          row.new_url,
          row.old_ats_type,
          row.new_ats_type,
          row.confidence,
          row.probe_ok,
          row.probe_status,
          row.probe_mode,
          row.probe_effective_url,
          row.probe_error,
          row.decision,
          row.notes,
        ]
          .map(csvEscape)
          .join(",")
      )
    )
    .join("\n")
  fs.writeFileSync(resultsPath, csv)

  const byDecision = new Map<string, number>()
  for (const row of decisions) {
    byDecision.set(row.decision, (byDecision.get(row.decision) ?? 0) + 1)
  }
  const decisionLines = [...byDecision.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v}`)

  const summary = [
    `mode=${mode}`,
    `input=${absInput}`,
    `total_rows=${parsed.length}`,
    `candidate_rows=${candidates.length}`,
    `validated_rows=${decisions.length}`,
    `applied_rows=${execute ? toApply.length : 0}`,
    `dry_run_apply_rows=${execute ? 0 : toApply.length}`,
    "",
    "decisions:",
    ...decisionLines,
    "",
    `results_csv=${resultsPath}`,
  ].join("\n")
  fs.writeFileSync(summaryPath, summary)

  console.log(`\nWrote results: ${resultsPath}`)
  console.log(`Wrote summary: ${summaryPath}`)
}

main().catch((error) => {
  console.error("apply-failure-url-patches failed:", error)
  process.exit(1)
})
