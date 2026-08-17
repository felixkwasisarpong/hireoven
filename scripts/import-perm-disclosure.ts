/**
 * PERM disclosure importer — streaming.
 *
 * Fills perm_records + perm_recruitment_windows (see scripts/migrations/add-perm-records.sql).
 * Uses lib/h1b/xlsx-stream.ts because the file is 156 MB compressed / ~1 GB of XML.
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/import-perm-disclosure.ts --file=.cache/PERM_FY2026_Q3.xlsx
 *   npx tsx scripts/import-perm-disclosure.ts --file=.cache/PERM_FY2026_Q3.xlsx --apply
 *
 * Source: https://www.dol.gov/media/PERM_Disclosure_Data_FY2026_Q3.xlsx
 * (newest quarter is served from /media/, older ones from /sites/dolgov/files/ETA/oflc/pdfs/).
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"
import { streamXlsxRows } from "@/lib/h1b/xlsx-stream"
import { normalizeEmployerName } from "@/lib/h1b/normalize-employer"

const APPLY = process.argv.includes("--apply")

function flagStr(name: string, fallback: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : fallback
}

const FILE = flagStr("file", ".cache/PERM_FY2026_Q3.xlsx")
const BATCH = 400

/**
 * The recruitment channels PERM records as from/to pairs. The first three are the mandatory
 * steps; the rest are the "three additional" menu for professional occupations.
 */
const RECRUITMENT_CHANNELS: { channel: string; from: string; to: string }[] = [
  { channel: "swa_job_order", from: "RECR_INFO_JOB_START_DATE", to: "RECR_INFO_JOB_END_DATE" },
  { channel: "employer_website", from: "RECR_OCC_EMP_WEBSITE_FROM", to: "RECR_OCC_EMP_WEBSITE_TO" },
  { channel: "job_search_site", from: "RECR_OCC_JOB_SEARCH_FROM", to: "RECR_OCC_JOB_SEARCH_TO" },
  { channel: "job_fair", from: "RECR_OCC_JOB_FAIR_FROM", to: "RECR_OCC_JOB_FAIR_TO" },
  { channel: "on_campus", from: "RECR_OCC_ON_CAMPUS_FROM", to: "RECR_OCC_ON_CAMPUS_TO" },
  { channel: "trade_org", from: "RECR_OCC_TRADE_ORG_FROM", to: "RECR_OCC_TRADE_ORG_TO" },
  { channel: "private_employment_firm", from: "RECR_OCC_PRIVATE_EMP_FROM", to: "RECR_OCC_PRIVATE_EMP_TO" },
  { channel: "employee_referral", from: "RECR_OCC_EMP_REFERRAL_FROM", to: "RECR_OCC_EMP_REFERRAL_TO" },
  { channel: "campus_placement", from: "RECR_OCC_CAMPUS_PLACEMENT_FROM", to: "RECR_OCC_CAMPUS_PLACEMENT_TO" },
  { channel: "local_newspaper", from: "RECR_OCC_LOCAL_NEWSPAPER_FROM", to: "RECR_OCC_LOCAL_NEWSPAPER_TO" },
  { channel: "radio_ad", from: "RECR_OCC_RADIO_AD_FROM", to: "RECR_OCC_RADIO_AD_TO" },
]

/**
 * Longest plausible recruitment window. PERM ads run for weeks, not years — measured across
 * 352,143 loaded windows the median is 18 days and the 99th percentile is 71. A handful of rows
 * carry typo'd end dates (observed: 2042-07-24, 2035-09-01), and those are exactly the rows that
 * dominate any "is this window still open" query, so an unbounded window would let one keystroke
 * flag an employer's postings as ghost jobs for two decades. 83 of 352,143 rows exceed this.
 */
const MAX_WINDOW_DAYS = 365

function toBool(v: string | undefined): boolean | null {
  const s = (v ?? "").trim().toLowerCase()
  if (!s) return null
  if (s === "y" || s === "yes" || s === "true" || s === "1") return true
  if (s === "n" || s === "no" || s === "false" || s === "0") return false
  return null
}

function toInt(v: string | undefined): number | null {
  const s = (v ?? "").trim()
  if (!s) return null
  const n = Number.parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

function toNum(v: string | undefined): number | null {
  const s = (v ?? "").trim().replace(/[$,]/g, "")
  if (!s) return null
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/** Excel serials and ISO-ish strings both appear. Serial epoch offset accounts for the 1900 bug. */
function toDate(v: string | undefined): string | null {
  const s = (v ?? "").trim()
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number.parseFloat(s)
    if (serial > 20000 && serial < 60000) {
      const d = new Date((serial - 25569) * 86400 * 1000)
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
    }
    return null
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

function fiscalYearOf(decisionDate: string | null): number | null {
  if (!decisionDate) return null
  const d = new Date(decisionDate)
  if (Number.isNaN(d.getTime())) return null
  return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()
}

const COLUMNS = [
  "case_number", "case_status", "received_date", "decision_date",
  "employer_name", "employer_name_normalized", "employer_fein", "employer_naics",
  "emp_num_payroll", "emp_year_commenced",
  "pwd_number", "pwd_soc_code", "pwd_soc_title", "job_title",
  "worksite_city", "worksite_county", "worksite_state", "worksite_postal_code", "worksite_bls_area",
  "wage_from", "wage_to", "wage_unit",
  "fw_currently_working", "employer_layoff", "fiscal_year",
] as const

async function main(): Promise<void> {
  console.log(`Reading ${FILE}`)

  let idx: Record<string, number> = {}
  const col = (row: string[], name: string): string | undefined => {
    const i = idx[name]
    return i === undefined ? undefined : row[i]
  }

  const pool = getPostgresPool()
  const client = APPLY ? await pool.connect() : null
  if (client) await client.query("SET statement_timeout = 0")

  let seen = 0
  let real = 0
  let written = 0
  let windowsWritten = 0
  let skippedWindows = 0
  const status: Record<string, number> = {}
  const stats = { pwd: 0, fwWorking: 0, layoff: 0, blsArea: 0, withWindows: 0 }

  let batch: unknown[][] = []
  let windowBatch: unknown[][] = []
  const t0 = Date.now()

  const flush = async () => {
    if (!client) {
      batch = []
      windowBatch = []
      return
    }
    if (batch.length) {
      const values: unknown[] = []
      const tuples = batch.map((r) => {
        const ph = r.map((v) => {
          values.push(v)
          return `$${values.length}`
        })
        return `(${ph.join(",")})`
      })
      await client.query(
        `INSERT INTO perm_records (${COLUMNS.join(",")}) VALUES ${tuples.join(",")}
         ON CONFLICT (case_number) DO UPDATE SET
           case_status = EXCLUDED.case_status,
           decision_date = EXCLUDED.decision_date,
           employer_name_normalized = EXCLUDED.employer_name_normalized,
           pwd_number = EXCLUDED.pwd_number,
           fw_currently_working = EXCLUDED.fw_currently_working,
           employer_layoff = EXCLUDED.employer_layoff`,
        values
      )
      written += batch.length
      batch = []
    }
    if (windowBatch.length) {
      const values: unknown[] = []
      const tuples = windowBatch.map((r) => {
        const ph = r.map((v) => {
          values.push(v)
          return `$${values.length}`
        })
        return `(${ph.join(",")})`
      })
      await client.query(
        `INSERT INTO perm_recruitment_windows (case_number, channel, from_date, to_date)
         VALUES ${tuples.join(",")} ON CONFLICT DO NOTHING`,
        values
      )
      windowsWritten += windowBatch.length
      windowBatch = []
    }
  }

  try {
    for await (const row of streamXlsxRows(FILE)) {
      if (seen === 0) {
        row.forEach((h, i) => {
          const k = (h ?? "").trim()
          if (k) idx[k] = i
        })
        for (const req of ["CASE_NUMBER", "CASE_STATUS", "EMP_BUSINESS_NAME", "PWD_SOC_CODE"]) {
          if (idx[req] === undefined) throw new Error(`Missing column ${req} — DOL changed the layout`)
        }
        console.log(`  ${row.length} columns`)
        seen++
        continue
      }
      seen++

      const caseNumber = (col(row, "CASE_NUMBER") ?? "").trim()
      if (!caseNumber) continue
      real++

      const st = (col(row, "CASE_STATUS") ?? "").trim()
      status[st] = (status[st] ?? 0) + 1

      const employer = (col(row, "EMP_BUSINESS_NAME") ?? "").trim()
      const decisionDate = toDate(col(row, "DECISION_DATE"))
      const pwd = (col(row, "JOB_OPP_PWD_NUMBER") ?? "").trim()
      const blsArea = (col(row, "PRIMARY_WORKSITE_BLS_AREA") ?? "").trim()
      const fw = toBool(col(row, "OTHER_REQ_IS_FW_CURRENTLY_WRK"))
      const layoff = toBool(col(row, "OTHER_REQ_EMP_LAYOFF"))

      if (pwd) stats.pwd++
      if (fw) stats.fwWorking++
      if (layoff) stats.layoff++
      if (blsArea) stats.blsArea++

      batch.push([
        caseNumber, st || null, toDate(col(row, "RECEIVED_DATE")), decisionDate,
        employer || null, employer ? normalizeEmployerName(employer) : null,
        (col(row, "EMP_FEIN") ?? "").trim() || null,
        (col(row, "EMP_NAICS") ?? "").trim() || null,
        toInt(col(row, "EMP_NUM_PAYROLL")),
        toInt(col(row, "EMP_YEAR_COMMENCED")),
        pwd || null,
        (col(row, "PWD_SOC_CODE") ?? "").trim() || null,
        (col(row, "PWD_SOC_TITLE") ?? "").trim() || null,
        (col(row, "JOB_TITLE") ?? "").trim() || null,
        (col(row, "PRIMARY_WORKSITE_CITY") ?? "").trim() || null,
        (col(row, "PRIMARY_WORKSITE_COUNTY") ?? "").trim() || null,
        (col(row, "PRIMARY_WORKSITE_STATE") ?? "").trim() || null,
        (col(row, "PRIMARY_WORKSITE_POSTAL_CODE") ?? "").trim() || null,
        blsArea || null,
        toNum(col(row, "JOB_OPP_WAGE_FROM")),
        toNum(col(row, "JOB_OPP_WAGE_TO")),
        (col(row, "JOB_OPP_WAGE_PER") ?? "").trim() || null,
        fw, layoff, fiscalYearOf(decisionDate),
      ])

      // Recruitment windows — only well-formed ranges are kept.
      let had = false
      const seenChannels = new Set<string>()
      for (const c of RECRUITMENT_CHANNELS) {
        const from = toDate(col(row, c.from))
        const to = toDate(col(row, c.to))
        if (!from || !to) continue
        if (to < from) continue
        // Drop typo'd end dates rather than trusting them — see MAX_WINDOW_DAYS.
        const spanDays = (Date.parse(to) - Date.parse(from)) / 86_400_000
        if (!Number.isFinite(spanDays) || spanDays > MAX_WINDOW_DAYS) {
          skippedWindows++
          continue
        }
        const key = `${c.channel}|${from}`
        if (seenChannels.has(key)) continue
        seenChannels.add(key)
        windowBatch.push([caseNumber, c.channel, from, to])
        had = true
      }
      if (had) stats.withWindows++

      if (batch.length >= BATCH) await flush()
      if (real % 25_000 === 0) {
        console.log(`  ${real.toLocaleString()} real rows (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
      }
    }
    await flush()

    const pct = (n: number) => `${((100 * n) / Math.max(real, 1)).toFixed(1)}%`
    console.log(`\nsheet rows       ${seen.toLocaleString()}`)
    console.log(`real rows        ${real.toLocaleString()}`)
    console.log(`PWD number       ${stats.pwd.toLocaleString()} (${pct(stats.pwd)})  <- join key to the PWD file`)
    console.log(`BLS area given   ${stats.blsArea.toLocaleString()} (${pct(stats.blsArea)})`)
    console.log(`FW already works ${stats.fwWorking.toLocaleString()} (${pct(stats.fwWorking)})`)
    console.log(`employer layoff  ${stats.layoff.toLocaleString()} (${pct(stats.layoff)})`)
    console.log(`with recruitment windows ${stats.withWindows.toLocaleString()} (${pct(stats.withWindows)})`)
    console.log(`implausible windows dropped ${skippedWindows.toLocaleString()} (span > ${MAX_WINDOW_DAYS}d)`)
    console.log(`\nCASE_STATUS:`)
    for (const [k, v] of Object.entries(status).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(v).padStart(7)}  ${k}`)
    }

    if (!APPLY) console.log("\nDry run — nothing written. Re-run with --apply.")
    else console.log(`\nWrote ${written.toLocaleString()} PERM rows, ${windowsWritten.toLocaleString()} recruitment windows.`)
  } finally {
    client?.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
