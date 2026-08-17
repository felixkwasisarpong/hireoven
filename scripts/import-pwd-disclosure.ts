/**
 * PWD (ETA-9141 prevailing wage determination) importer — streaming.
 *
 * Fills pwd_records (see scripts/migrations/add-pwd-records.sql) for §2 Green Card Radar and
 * §5 the ACWIA cap-exempt registry. Uses lib/h1b/xlsx-stream.ts — the file is 159 MB compressed.
 *
 * Dry run by default; pass --apply to write.
 *
 *   npx tsx scripts/import-pwd-disclosure.ts --file=.cache/PW_FY2026_Q3.xlsx
 *   npx tsx scripts/import-pwd-disclosure.ts --file=.cache/PW_FY2026_Q3.xlsx --apply
 *
 * Source: https://www.dol.gov/media/PW_Disclosure_Data_FY2026_Q3.xlsx
 * NOTE the file is named PW_*, not PWD_* — PWD_Disclosure_Data_* 404s.
 */

import { loadEnvConfig } from "@next/env"
loadEnvConfig(process.cwd())

import { getPostgresPool } from "@/lib/postgres/server"
import { streamXlsxRows } from "@/lib/h1b/xlsx-stream"
import { normalizeEmployerName } from "@/lib/h1b/normalize-employer"
import { bareSocCode } from "@/lib/salaries/soc-classifier"

const APPLY = process.argv.includes("--apply")

function flagStr(name: string, fallback: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split("=").slice(1).join("=") : fallback
}

const FILE = flagStr("file", ".cache/PW_FY2026_Q3.xlsx")
const BATCH = 400

function toBool(v: string | undefined): boolean | null {
  const s = (v ?? "").trim().toLowerCase()
  if (!s) return null
  if (s === "y" || s === "yes" || s === "true" || s === "1") return true
  if (s === "n" || s === "no" || s === "false" || s === "0") return false
  return null
}

function toNum(v: string | undefined): number | null {
  const s = (v ?? "").trim().replace(/[$,]/g, "")
  if (!s) return null
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

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

const COLUMNS = [
  "case_number", "case_status", "visa_class",
  "received_date", "determination_date", "redetermination_date", "expiration_date",
  "employer_name", "employer_name_normalized", "employer_fein",
  "suggested_soc_code", "pwd_soc_code", "pwd_soc_title", "soc_overridden", "job_title",
  "worksite_city", "worksite_county", "worksite_state", "worksite_postal_code",
  "pwd_wage_rate", "pwd_wage_unit", "pwd_oes_wage_level", "required_education_level",
  "covered_by_acwia", "acwia_higher_education", "acwia_affiliated_nonprofit", "acwia_research_org",
] as const

async function main(): Promise<void> {
  console.log(`Reading ${FILE}`)

  const idx: Record<string, number> = {}
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
  const visa: Record<string, number> = {}
  const stats = { acwia: 0, he: 0, np: 0, ro: 0, overridden: 0, socComparable: 0, unexpired: 0 }
  let batch: unknown[][] = []
  const today = new Date().toISOString().slice(0, 10)
  const t0 = Date.now()

  const flush = async () => {
    if (!client || !batch.length) {
      batch = []
      return
    }
    const values: unknown[] = []
    const tuples = batch.map((r) => {
      const ph = r.map((v) => {
        values.push(v)
        return `$${values.length}`
      })
      return `(${ph.join(",")})`
    })
    await client.query(
      `INSERT INTO pwd_records (${COLUMNS.join(",")}) VALUES ${tuples.join(",")}
       ON CONFLICT (case_number) DO UPDATE SET
         case_status = EXCLUDED.case_status,
         determination_date = EXCLUDED.determination_date,
         expiration_date = EXCLUDED.expiration_date,
         soc_overridden = EXCLUDED.soc_overridden,
         covered_by_acwia = EXCLUDED.covered_by_acwia`,
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
        for (const req of ["CASE_NUMBER", "EMPLOYER_LEGAL_BUSINESS_NAME", "PWD_SOC_CODE", "COVERED_BY_ACWIA"]) {
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

      const v = (col(row, "VISA_CLASS") ?? "").trim()
      visa[v] = (visa[v] ?? 0) + 1

      const employer = (col(row, "EMPLOYER_LEGAL_BUSINESS_NAME") ?? "").trim()

      // Compare BARE codes — the suggested code carries the O*NET '.00' suffix and a raw
      // comparison marks 99.99% of filings as overridden.
      const suggested = bareSocCode(col(row, "SUGGESTED_SOC_CODE"))
      const determined = bareSocCode(col(row, "PWD_SOC_CODE"))
      let overridden: boolean | null = null
      if (suggested && determined) {
        overridden = suggested !== determined
        stats.socComparable++
        if (overridden) stats.overridden++
      }

      const acwia = toBool(col(row, "COVERED_BY_ACWIA"))
      const he = toBool(col(row, "ACWIA_INST_HIGHER_EDUCATION"))
      const np = toBool(col(row, "ACWIA_AFFILIATED_NON_PROFIT"))
      const ro = toBool(col(row, "ACWIA_RESEARCH_ORG"))
      if (acwia) stats.acwia++
      if (he) stats.he++
      if (np) stats.np++
      if (ro) stats.ro++

      const expiration = toDate(col(row, "PWD_WAGE_EXPIRATION_DATE"))
      if (expiration && expiration >= today) stats.unexpired++

      batch.push([
        caseNumber,
        (col(row, "CASE_STATUS") ?? "").trim() || null,
        v || null,
        toDate(col(row, "RECEIVED_DATE")),
        toDate(col(row, "DETERMINATION_DATE")),
        toDate(col(row, "REDETERMINATION_DATE")),
        expiration,
        employer || null,
        employer ? normalizeEmployerName(employer) : null,
        (col(row, "EMPLOYER_FEIN") ?? "").trim() || null,
        suggested,
        determined,
        (col(row, "PWD_SOC_TITLE") ?? "").trim() || null,
        overridden,
        (col(row, "JOB_TITLE") ?? "").trim() || null,
        (col(row, "PRIMARY_WORKSITE_CITY") ?? "").trim() || null,
        (col(row, "PRIMARY_WORKSITE_COUNTY") ?? "").trim() || null,
        (col(row, "PRIMARY_WORKSITE_STATE") ?? "").trim() || null,
        (col(row, "PRIMARY_WORKSITE_POSTAL_CODE") ?? "").trim() || null,
        toNum(col(row, "PWD_WAGE_RATE")),
        (col(row, "PWD_UNIT_OF_PAY") ?? "").trim() || null,
        (col(row, "PWD_OES_WAGE_LEVEL") ?? "").trim() || null,
        (col(row, "REQUIRED_EDUCATION_LEVEL") ?? "").trim() || null,
        acwia, he, np, ro,
      ])

      if (batch.length >= BATCH) await flush()
      if (real % 25_000 === 0) {
        console.log(`  ${real.toLocaleString()} real rows (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
      }
    }
    await flush()

    const pct = (n: number, d = real) => `${((100 * n) / Math.max(d, 1)).toFixed(1)}%`
    console.log(`\nsheet rows        ${seen.toLocaleString()}`)
    console.log(`real rows         ${real.toLocaleString()}`)
    console.log(`unexpired PWDs    ${stats.unexpired.toLocaleString()} (${pct(stats.unexpired)})  <- §2 radar population`)
    console.log(`SOC overridden    ${stats.overridden.toLocaleString()} of ${stats.socComparable.toLocaleString()} comparable (${pct(stats.overridden, stats.socComparable)})`)
    console.log(`ACWIA covered     ${stats.acwia.toLocaleString()}  [higher-ed ${stats.he.toLocaleString()} · nonprofit ${stats.np.toLocaleString()} · research ${stats.ro.toLocaleString()}]`)
    console.log(`\nVISA_CLASS:`)
    for (const [k, n] of Object.entries(visa).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      console.log(`  ${String(n).padStart(7)}  ${k}`)
    }

    if (!APPLY) console.log("\nDry run — nothing written. Re-run with --apply.")
    else console.log(`\nWrote ${written.toLocaleString()} PWD rows.`)
  } finally {
    client?.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
