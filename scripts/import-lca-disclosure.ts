/**
 * Bulk LCA disclosure importer — streaming, for the full-size DOL files.
 *
 * Complements lib/h1b/lca-importer.ts (which backs the admin upload flow and loads a whole
 * workbook into memory). That approach cannot survive the current files: FY2026 Q3 is 252 MB
 * compressed / 1.6 GB of XML. This uses lib/h1b/xlsx-stream.ts and stays at ~175 MB heap.
 *
 * Populates the transfer-velocity (§4) and third-party-placement (§6) columns added by
 * scripts/migrations/add-lca-transfer-and-secondary-entity.sql, alongside the existing fields.
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/import-lca-disclosure.ts --file=.cache/LCA_FY2026_Q3.xlsx
 *   npx tsx scripts/import-lca-disclosure.ts --file=.cache/LCA_FY2026_Q3.xlsx --apply
 *
 * Idempotent: upserts on the existing unique (source_case_number, fiscal_year) index, so a
 * re-run refreshes rather than duplicates. Employer->company linking is NOT done here; it stays
 * the job of scripts/reconcile-companies-from-imports.ts (single authoritative path).
 *
 * File source: https://www.dol.gov/agencies/eta/foreign-labor/performance
 * Note the newest quarter is served from /media/ rather than the older
 * /sites/dolgov/files/ETA/oflc/pdfs/ path.
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
function flagInt(name: string, fallback: number): number {
  const v = Number.parseInt(flagStr(name, ""), 10)
  return Number.isFinite(v) && v > 0 ? v : fallback
}

const FILE = flagStr("file", ".cache/LCA_FY2026_Q3.xlsx")
const LIMIT = flagInt("limit", 0) // 0 = all
const BATCH = 500

/**
 * 'Yes'/'No' and 'Y'/'N' both appear in this file — SECONDARY_ENTITY and H_1B_DEPENDENT use the
 * long form while FULL_TIME_POSITION uses the short one, in the same row.
 */
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

/**
 * Excel serial dates come through as numbers; ISO-ish strings also appear. Serial 1 = 1900-01-01
 * with Excel's 1900 leap-year bug, hence the 25569-day epoch offset.
 */
function toDate(v: string | undefined): string | null {
  const s = (v ?? "").trim()
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number.parseFloat(s)
    if (serial > 20000 && serial < 60000) {
      const ms = (serial - 25569) * 86400 * 1000
      const d = new Date(ms)
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
    }
    return null
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

const US_STATE_ABBR = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
  "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA",
  "RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","VI","GU",
])

function stateAbbr(v: string | undefined): string | null {
  const s = (v ?? "").trim().toUpperCase()
  if (!s) return null
  return US_STATE_ABBR.has(s) ? s : null
}

/** Fiscal year from the DOL case number ('I-200-25039-677546' -> the 25 is FY2025's stamp). */
function fiscalYearFrom(caseNumber: string, decisionDate: string | null): number | null {
  const m = /^[A-Z]-\d{3}-(\d{2})\d{3}-/.exec(caseNumber)
  if (m) {
    const yy = Number.parseInt(m[1], 10)
    if (Number.isFinite(yy)) return 2000 + yy
  }
  if (decisionDate) {
    const d = new Date(decisionDate)
    if (!Number.isNaN(d.getTime())) {
      // Federal FY starts 1 October.
      return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()
    }
  }
  return null
}

const COLUMNS = [
  "source_case_number", "fiscal_year", "employer_name", "employer_name_normalized",
  "job_title", "soc_code", "soc_title", "worksite_city", "worksite_state", "worksite_state_abbr",
  "wage_rate_from", "wage_rate_to", "wage_unit", "prevailing_wage", "prevailing_wage_unit",
  "wage_level", "case_status", "decision_date", "visa_class", "employment_start_date",
  "employment_end_date", "full_time_position", "naics_code",
  "employer_fein", "new_employment", "continued_employment", "change_previous_employment",
  "new_concurrent_employment", "change_employer", "amended_petition", "total_worker_positions",
  "secondary_entity", "secondary_entity_name", "secondary_entity_normalized",
  "h1b_dependent", "willful_violator", "worksite_postal_code", "worksite_county", "received_date",
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
  let skippedNoKey = 0
  const stats = {
    withFein: 0, transfers: 0, transferPositions: 0, secondary: 0, dependent: 0,
    newEmployment: 0, totalPositions: 0,
  }
  const endClients = new Map<string, number>()
  let batch: unknown[][] = []
  const t0 = Date.now()

  const flush = async () => {
    if (!client || !batch.length) return
    const values: unknown[] = []
    const tuples = batch.map((r) => {
      const ph = r.map((v) => {
        values.push(v)
        return `$${values.length}`
      })
      return `(${ph.join(",")})`
    })
    // Refresh on re-import rather than duplicating. The unique index is (source_case_number,
    // fiscal_year); company_id is deliberately untouched so reconciliation stays authoritative.
    await client.query(
      `INSERT INTO lca_records (${COLUMNS.join(",")}) VALUES ${tuples.join(",")}
       ON CONFLICT (source_case_number, fiscal_year) DO UPDATE SET
         employer_fein = EXCLUDED.employer_fein,
         new_employment = EXCLUDED.new_employment,
         continued_employment = EXCLUDED.continued_employment,
         change_previous_employment = EXCLUDED.change_previous_employment,
         new_concurrent_employment = EXCLUDED.new_concurrent_employment,
         change_employer = EXCLUDED.change_employer,
         amended_petition = EXCLUDED.amended_petition,
         total_worker_positions = EXCLUDED.total_worker_positions,
         secondary_entity = EXCLUDED.secondary_entity,
         secondary_entity_name = EXCLUDED.secondary_entity_name,
         secondary_entity_normalized = EXCLUDED.secondary_entity_normalized,
         h1b_dependent = EXCLUDED.h1b_dependent,
         willful_violator = EXCLUDED.willful_violator,
         worksite_postal_code = EXCLUDED.worksite_postal_code,
         worksite_county = EXCLUDED.worksite_county,
         received_date = EXCLUDED.received_date,
         case_status = EXCLUDED.case_status,
         decision_date = EXCLUDED.decision_date`,
      values
    )
    written += batch.length
    batch = []
  }

  try {
    for await (const row of streamXlsxRows(FILE)) {
      if (seen === 0) {
        row.forEach((h, i) => {
          const k = (h ?? "").trim()
          if (k) idx[k] = i
        })
        for (const required of ["CASE_NUMBER", "EMPLOYER_FEIN", "CHANGE_EMPLOYER", "SECONDARY_ENTITY"]) {
          if (idx[required] === undefined) throw new Error(`Missing column ${required} — DOL changed the layout`)
        }
        console.log(`  ${row.length} columns`)
        seen++
        continue
      }
      seen++

      // Hundreds of thousands of trailing blank rows are normal in these files.
      const caseNumber = (col(row, "CASE_NUMBER") ?? "").trim()
      if (!caseNumber) {
        skippedNoKey++
        continue
      }
      real++

      const decisionDate = toDate(col(row, "DECISION_DATE"))
      const fy = fiscalYearFrom(caseNumber, decisionDate)
      if (!fy) {
        skippedNoKey++
        continue
      }

      const employer = (col(row, "EMPLOYER_NAME") ?? "").trim()
      const secName = (col(row, "SECONDARY_ENTITY_BUSINESS_NAME") ?? "").trim()
      const secNorm = secName ? normalizeEmployerName(secName) : null
      const changeEmployer = toInt(col(row, "CHANGE_EMPLOYER"))
      const totalPositions = toInt(col(row, "TOTAL_WORKER_POSITIONS"))
      const newEmp = toInt(col(row, "NEW_EMPLOYMENT"))

      if (col(row, "EMPLOYER_FEIN")?.trim()) stats.withFein++
      if (changeEmployer && changeEmployer > 0) {
        stats.transfers++
        stats.transferPositions += changeEmployer
      }
      if (secNorm) {
        stats.secondary++
        endClients.set(secNorm, (endClients.get(secNorm) ?? 0) + 1)
      }
      if (toBool(col(row, "H_1B_DEPENDENT"))) stats.dependent++
      stats.newEmployment += newEmp ?? 0
      stats.totalPositions += totalPositions ?? 0

      batch.push([
        caseNumber, fy, employer, employer ? normalizeEmployerName(employer) : null,
        (col(row, "JOB_TITLE") ?? "").trim() || null,
        (col(row, "SOC_CODE") ?? "").trim() || null,
        (col(row, "SOC_TITLE") ?? "").trim() || null,
        (col(row, "WORKSITE_CITY") ?? "").trim() || null,
        (col(row, "WORKSITE_STATE") ?? "").trim() || null,
        stateAbbr(col(row, "WORKSITE_STATE")),
        toNum(col(row, "WAGE_RATE_OF_PAY_FROM")),
        toNum(col(row, "WAGE_RATE_OF_PAY_TO")),
        (col(row, "WAGE_UNIT_OF_PAY") ?? "").trim() || null,
        toNum(col(row, "PREVAILING_WAGE")),
        (col(row, "PW_UNIT_OF_PAY") ?? "").trim() || null,
        (col(row, "PW_WAGE_LEVEL") ?? "").trim() || null,
        (col(row, "CASE_STATUS") ?? "").trim() || null,
        decisionDate,
        (col(row, "VISA_CLASS") ?? "").trim() || "H-1B",
        toDate(col(row, "BEGIN_DATE")) ?? toDate(col(row, "EMPLOYMENT_START_DATE")),
        toDate(col(row, "END_DATE")) ?? toDate(col(row, "EMPLOYMENT_END_DATE")),
        toBool(col(row, "FULL_TIME_POSITION")),
        (col(row, "NAICS_CODE") ?? "").trim() || null,
        (col(row, "EMPLOYER_FEIN") ?? "").trim() || null,
        newEmp,
        toInt(col(row, "CONTINUED_EMPLOYMENT")),
        toInt(col(row, "CHANGE_PREVIOUS_EMPLOYMENT")),
        toInt(col(row, "NEW_CONCURRENT_EMPLOYMENT")),
        changeEmployer,
        toInt(col(row, "AMENDED_PETITION")),
        totalPositions,
        toBool(col(row, "SECONDARY_ENTITY")),
        secName || null,
        secNorm,
        toBool(col(row, "H_1B_DEPENDENT")),
        toBool(col(row, "WILLFUL_VIOLATOR")),
        (col(row, "WORKSITE_POSTAL_CODE") ?? "").trim() || null,
        (col(row, "WORKSITE_COUNTY") ?? "").trim() || null,
        toDate(col(row, "RECEIVED_DATE")) ?? toDate(col(row, "CASE_RECEIVED_DATE")),
      ])

      if (batch.length >= BATCH) await flush()
      if (real % 100_000 === 0) {
        console.log(`  ${real.toLocaleString()} real rows (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
      }
      if (LIMIT && real >= LIMIT) break
    }
    await flush()

    const pct = (n: number) => `${((100 * n) / Math.max(real, 1)).toFixed(1)}%`
    console.log(`\nsheet rows        ${seen.toLocaleString()}`)
    console.log(`real rows         ${real.toLocaleString()}  (blank/no-key skipped ${skippedNoKey.toLocaleString()})`)
    console.log(`employer FEIN     ${stats.withFein.toLocaleString()} (${pct(stats.withFein)})`)
    console.log(`H-1B TRANSFERS    ${stats.transfers.toLocaleString()} rows (${pct(stats.transfers)}), ${stats.transferPositions.toLocaleString()} positions`)
    console.log(`secondary entity  ${stats.secondary.toLocaleString()} (${pct(stats.secondary)}) — distinct end clients ${endClients.size.toLocaleString()}`)
    console.log(`H-1B dependent    ${stats.dependent.toLocaleString()} (${pct(stats.dependent)})`)
    console.log(`positions         ${stats.totalPositions.toLocaleString()} total, ${stats.newEmployment.toLocaleString()} new employment`)

    const top = [...endClients.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    if (top.length) {
      console.log(`\ntop end clients (placement targets):`)
      for (const [name, n] of top) console.log(`  ${String(n).padStart(5)}  ${name}`)
    }

    if (!APPLY) console.log("\nDry run — nothing written. Re-run with --apply.")
    else console.log(`\nWrote ${written.toLocaleString()} rows.`)
  } finally {
    client?.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
