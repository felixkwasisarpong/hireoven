import { parse as parseCSV } from "csv-parse/sync"
import { getPostgresPool } from "@/lib/postgres/server"
import { matchCompany } from "@/lib/layoffs/company-matcher"
import { computeLayoffSummary } from "@/lib/layoffs/summary-computer"

// Primary URL — Google Sheets public export from layoffs.fyi
const PRIMARY_URL =
  "https://docs.google.com/spreadsheets/d/1LPSPwv7Eqz2gBuLMdSjvL8TnQ5Pz2fL/export?format=csv"
const LAYOFFS_FYI_HOME = "https://layoffs.fyi"

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/csv,application/csv,text/plain,*/*",
}

export type LayoffsFyiResult = {
  rowsProcessed: number
  newEvents: number
  duplicatesSkipped: number
  matchFailures: number
  errors: string[]
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw?.trim()) return null
  const s = raw.trim()

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00Z")

  // MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return new Date(`${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}T00:00:00Z`)

  // Month DD, YYYY or Month DD YYYY
  const monthNames = "january|february|march|april|may|june|july|august|september|october|november|december"
  const longDate = s.match(new RegExp(`^(${monthNames})\\s+(\\d{1,2})[,\\s]+(\\d{4})$`, "i"))
  if (longDate) {
    const month = ["january","february","march","april","may","june","july","august","september","october","november","december"]
      .indexOf(longDate[1].toLowerCase()) + 1
    return new Date(`${longDate[3]}-${String(month).padStart(2,"0")}-${longDate[2].padStart(2,"0")}T00:00:00Z`)
  }

  // Try native parse as last resort
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// ── Employee count parsing ────────────────────────────────────────────────────

function parseEmployeeCount(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null
  const s = raw.trim().toLowerCase()
  if (s === "unknown" || s === "n/a" || s === "-") return null

  // Range: "100-200" → midpoint
  const range = s.match(/^(\d+)\s*[-–]\s*(\d+)$/)
  if (range) return Math.round((Number(range[1]) + Number(range[2])) / 2)

  // With commas/K suffix
  const withK = s.match(/^([\d,]+)k$/i)
  if (withK) return Number(withK[1].replace(/,/g, "")) * 1000

  const digits = s.replace(/[^0-9]/g, "")
  const n = Number(digits)
  return Number.isFinite(n) && n > 0 ? n : null
}

// ── Percentage parsing ────────────────────────────────────────────────────────

function parsePercentage(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null
  const n = Number(raw.trim().replace(/[%\s]/g, ""))
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null
}

// ── CSV fetch with fallback ───────────────────────────────────────────────────

async function fetchCsv(): Promise<string | null> {
  // Try primary URL
  try {
    const res = await fetch(PRIMARY_URL, { headers: BROWSER_HEADERS, redirect: "follow" })
    if (res.ok) {
      const text = await res.text()
      if (text.includes(",") && text.length > 100) return text
    }
  } catch { /* fall through */ }

  // Fallback: scrape layoffs.fyi for the export link
  try {
    const homeRes = await fetch(LAYOFFS_FYI_HOME, { headers: BROWSER_HEADERS })
    if (!homeRes.ok) return null
    const html = await homeRes.text()
    const match = html.match(/https:\/\/docs\.google\.com\/spreadsheets[^"'\s]+export[^"'\s]+csv[^"'\s]*/i)
    if (!match) return null

    const csvRes = await fetch(match[0], { headers: BROWSER_HEADERS, redirect: "follow" })
    if (!csvRes.ok) return null
    const text = await csvRes.text()
    return text.includes(",") ? text : null
  } catch { return null }
}

// ── Main import ───────────────────────────────────────────────────────────────

export async function importLayoffsFyi(): Promise<LayoffsFyiResult> {
  const result: LayoffsFyiResult = { rowsProcessed: 0, newEvents: 0, duplicatesSkipped: 0, matchFailures: 0, errors: [] }
  const pool = getPostgresPool()

  const csv = await fetchCsv()
  if (!csv) {
    result.errors.push("Could not fetch layoffs.fyi CSV — source unreachable")
    return result
  }

  let rows: Record<string, string>[]
  try {
    rows = parseCSV(csv, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true })
  } catch (e) {
    result.errors.push(`CSV parse error: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  const affectedCompanyIds = new Set<string>()
  const BATCH = 50

  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      for (const row of chunk) {
        result.rowsProcessed++
        try {
          const companyName = (row["Company"] ?? row["company"] ?? "").trim()
          if (!companyName) continue

          const eventDate = parseDate(row["Date"] ?? row["date"] ?? "")
          if (!eventDate || isNaN(eventDate.getTime())) continue

          const dateStr = eventDate.toISOString().slice(0, 10)
          const employees = parseEmployeeCount(row["Laid_Off_Count"] ?? row["laid_off_count"] ?? "")
          const percentage = parsePercentage(row["Percentage"] ?? row["percentage"] ?? "")
          const sourceUrl = (row["Source"] ?? row["source"] ?? "").trim() || null
          const location = (row["Location"] ?? row["location"] ?? "").trim() || null
          const industry = (row["Industry"] ?? row["industry"] ?? "").trim() || null

          // Deduplicate
          const { rows: existing } = await client.query(
            `SELECT id FROM layoff_events WHERE company_name_raw = $1 AND event_date = $2 AND source = 'layoffs_fyi' LIMIT 1`,
            [companyName, dateStr]
          )
          if (existing.length > 0) { result.duplicatesSkipped++; continue }

          // Match company
          const match = await matchCompany({ companyNameRaw: companyName, sourceUrl, source: "layoffs_fyi" })
          if (!match.matched) result.matchFailures++
          if (match.companyId) affectedCompanyIds.add(match.companyId)

          await client.query(
            `INSERT INTO layoff_events
               (company_id, company_name_raw, source, event_date, employees_affected,
                percentage_affected, location, industry, source_url, is_verified)
             VALUES ($1,$2,'layoffs_fyi',$3,$4,$5,$6,$7,$8,false)`,
            [match.companyId, companyName, dateStr, employees, percentage, location, industry, sourceUrl]
          )
          result.newEvents++
        } catch (rowErr) {
          result.errors.push(`Row error: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`)
        }
      }
      await client.query("COMMIT")
    } catch (batchErr) {
      await client.query("ROLLBACK")
      result.errors.push(`Batch error: ${batchErr instanceof Error ? batchErr.message : String(batchErr)}`)
    } finally {
      client.release()
    }
  }

  // Recompute summaries for all affected companies
  for (const companyId of affectedCompanyIds) {
    await computeLayoffSummary(companyId).catch(() => {})
  }

  return result
}
