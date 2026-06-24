import { parse as parseCSV } from "csv-parse/sync"
import { getPostgresPool } from "@/lib/postgres/server"
import { normalizeCompanyName } from "@/lib/layoffs/company-matcher"
import { computeAllSummaries } from "@/lib/layoffs/summary-computer"

// Source: layoffdata.com publishes free public Google Sheets aggregating state WARN
// filings (legally-mandated mass-layoff / closure notices). The old layoffs.fyi sheet
// went dead (404) and the DOL national page 403s scrapers, so this is our WARN feed.
// Sheet IDs are env-overridable so a future re-publish is a one-line config change.
const SHEET_2026 = process.env.LAYOFFDATA_SHEET_2026 ?? "1q47pIyvmtY7GtF3-7mHOrqBe_0uot_G944XELZ_3raU"
const SHEET_HISTORICAL =
  process.env.LAYOFFDATA_SHEET_HISTORICAL ?? "1B1CYZFyJ1ghK1ApuXEeGKo3mLYWzLwONvmWV8Plkav8"
const csvExportUrl = (id: string) =>
  `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`

// Only ingest events recent enough to matter to the signal (12mo counts + 24mo source refs).
const LOOKBACK_MONTHS = 24

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/csv,application/csv,text/plain,*/*",
}

export type LayoffDataResult = {
  rowsProcessed: number
  skippedOld: number
  newEvents: number
  duplicatesSkipped: number
  matchFailures: number
  companiesAffected: number
  errors: string[]
}

type Row = Record<string, string>

function parseDate(raw: string | undefined): Date | null {
  const s = raw?.trim()
  if (!s) return null
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    return new Date(`${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}T00:00:00Z`)
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00Z`)
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function parseWorkers(raw: string | undefined): number | null {
  const s = raw?.trim()
  if (!s) return null
  const range = s.match(/^([\d,]+)\s*[-–]\s*([\d,]+)$/)
  if (range) {
    return Math.round((Number(range[1].replace(/,/g, "")) + Number(range[2].replace(/,/g, ""))) / 2)
  }
  const n = Number(s.replace(/[^0-9]/g, ""))
  return Number.isFinite(n) && n > 0 ? n : null
}

function pick(row: Row, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k]
    if (v != null && String(v).trim() !== "") return String(v).trim()
  }
  return undefined
}

async function fetchSheet(id: string): Promise<Row[]> {
  const res = await fetch(csvExportUrl(id), { headers: BROWSER_HEADERS, redirect: "follow" })
  if (!res.ok) throw new Error(`sheet ${id} fetch failed: ${res.status}`)
  const csv = await res.text()
  return parseCSV(csv, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Row[]
}

export async function importLayoffData(
  opts: { dryRun?: boolean } = {}
): Promise<LayoffDataResult> {
  const result: LayoffDataResult = {
    rowsProcessed: 0,
    skippedOld: 0,
    newEvents: 0,
    duplicatesSkipped: 0,
    matchFailures: 0,
    companiesAffected: 0,
    errors: [],
  }
  const pool = getPostgresPool()
  const cutoff = new Date()
  cutoff.setUTCMonth(cutoff.getUTCMonth() - LOOKBACK_MONTHS)

  let rows: Row[] = []
  for (const id of [SHEET_2026, SHEET_HISTORICAL]) {
    try {
      rows = rows.concat(await fetchSheet(id))
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  if (rows.length === 0) {
    result.errors.push("No rows fetched from any sheet")
    return result
  }

  // Load companies ONCE and match in-process. matchCompany() does several remote
  // round-trips per name, which is fatal over a high-latency link for thousands of
  // rows — we mirror its exact + normalized-name strategy locally instead.
  const AMBIGUOUS = Symbol("ambiguous")
  const byExact = new Map<string, string | typeof AMBIGUOUS>()
  const byNorm = new Map<string, string | typeof AMBIGUOUS>()
  const { rows: companyRows } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM companies WHERE is_active = true"
  )
  for (const c of companyRows) {
    const exact = c.name.trim().toLowerCase()
    byExact.set(exact, byExact.has(exact) ? AMBIGUOUS : c.id)
    const norm = normalizeCompanyName(c.name)
    if (norm) byNorm.set(norm, byNorm.has(norm) ? AMBIGUOUS : c.id)
  }
  const matchLocal = (name: string): string | null => {
    const ex = byExact.get(name.trim().toLowerCase())
    if (ex && ex !== AMBIGUOUS) return ex
    const norm = normalizeCompanyName(name)
    const nm = norm ? byNorm.get(norm) : undefined
    return nm && nm !== AMBIGUOUS ? nm : null
  }

  type Event = {
    companyId: string | null
    company: string
    dateStr: string
    workers: number | null
    location: string | null
    headline: string
  }
  const events: Event[] = []
  const affected = new Set<string>()

  for (const row of rows) {
    const company = pick(row, "Company")
    const date = parseDate(pick(row, "WARN Received Date", "Effective Date"))
    if (!company || !date || isNaN(date.getTime())) continue
    if (date < cutoff) {
      result.skippedOld++
      continue
    }
    result.rowsProcessed++
    const companyId = matchLocal(company)
    if (!companyId) result.matchFailures++
    else affected.add(companyId)

    const layoffType = pick(row, "Closure/Layoff", "Closure / Layoff")
    events.push({
      companyId,
      company,
      dateStr: date.toISOString().slice(0, 10),
      workers: parseWorkers(pick(row, "Number of Workers")),
      location: [pick(row, "City"), pick(row, "State")].filter(Boolean).join(", ") || null,
      headline: layoffType ? `WARN Act: ${layoffType}` : "WARN Act notice filed",
    })
  }

  result.companiesAffected = affected.size
  if (opts.dryRun) {
    result.newEvents = events.length // would-attempt (ignores existing dupes)
    return result
  }

  // Batched upsert — dedup via the (company_name_raw, event_date, source) unique index.
  const CHUNK = 500
  for (let i = 0; i < events.length; i += CHUNK) {
    const slice = events.slice(i, i + CHUNK)
    const params: unknown[] = []
    const tuples = slice.map((e) => {
      const b = params.length
      params.push(e.companyId, e.company, e.dateStr, e.workers, e.location, e.headline)
      return `($${b + 1},$${b + 2},'warn_act',$${b + 3},$${b + 4},$${b + 5},'https://layoffdata.com/data/',$${b + 6},true)`
    })
    try {
      const ins = await pool.query(
        `INSERT INTO layoff_events
           (company_id, company_name_raw, source, event_date, employees_affected,
            location, source_url, headline, is_verified)
         VALUES ${tuples.join(",")}
         ON CONFLICT (company_name_raw, event_date, source) DO NOTHING`,
        params
      )
      const inserted = ins.rowCount ?? 0
      result.newEvents += inserted
      result.duplicatesSkipped += slice.length - inserted
    } catch (e) {
      result.errors.push(`Batch insert error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (affected.size > 0) {
    const { failed } = await computeAllSummaries([...affected])
    if (failed > 0) result.errors.push(`${failed} summary recomputes failed`)
  }
  return result
}
