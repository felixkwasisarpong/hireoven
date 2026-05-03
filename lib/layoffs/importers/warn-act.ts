import * as XLSX from "xlsx"
import { getPostgresPool } from "@/lib/postgres/server"
import { matchCompany } from "@/lib/layoffs/company-matcher"
import { computeLayoffSummary } from "@/lib/layoffs/summary-computer"

const WARN_PAGE = "https://www.dol.gov/agencies/eta/layoffs/warn"
const DOL_BASE  = "https://www.dol.gov"

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

export type WarnActResult = {
  rowsProcessed: number
  newEvents: number
  duplicatesSkipped: number
  matchFailures: number
  errors: string[]
}

// ── Extract download links from WARN page HTML ────────────────────────────────

function extractFileLinks(html: string): string[] {
  const links: string[] = []
  // Match .xlsx, .xls, .csv download links that relate to WARN/layoff
  const pattern = /href="([^"]*(?:warn|layoff|notice|worker)[^"]*\.(?:xlsx|xls|csv|txt))"[^>]*/gi
  let match: RegExpExecArray | null
  const re = new RegExp(pattern.source, pattern.flags)
  while ((match = re.exec(html)) !== null) {
    const href = match[1]
    const url = href.startsWith("http") ? href : `${DOL_BASE}${href}`
    if (!links.includes(url)) links.push(url)
  }
  // Also capture any generic spreadsheet links on this page
  const genericPattern = /href="([^"]*\/sites\/[^"]*\.(?:xlsx|xls))"/gi
  const re2 = new RegExp(genericPattern.source, genericPattern.flags)
  while ((match = re2.exec(html)) !== null) {
    const href = match[1]
    const url = href.startsWith("http") ? href : `${DOL_BASE}${href}`
    if (!links.includes(url) && links.length < 10) links.push(url)
  }
  return links.slice(0, 5) // cap at 5 files per run
}

// ── Parse WARN row from sheet data ────────────────────────────────────────────

type WarnRow = {
  companyName: string
  location: string | null
  noticeDate: Date | null
  employeesAffected: number | null
  layoffType: string | null
}

function parseWarnDate(val: unknown): Date | null {
  if (!val) return null
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val
  const s = String(val).trim()
  if (!s) return null
  // Excel serial number
  const serial = Number(s)
  if (Number.isFinite(serial) && serial > 10000) {
    return XLSX.SSF.parse_date_code(serial) ? new Date(XLSX.SSF.format("yyyy-mm-dd", serial) + "T00:00:00Z") : null
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function parseWarnSheet(wb: XLSX.WorkBook): WarnRow[] {
  const rows: WarnRow[] = []
  const sheet = wb.Sheets[wb.SheetNames[0]]
  if (!sheet) return rows

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })

  for (const row of data) {
    // Flexible column name matching
    const keys = Object.keys(row)
    const get = (patterns: string[]) => {
      for (const p of patterns) {
        const key = keys.find(k => k.toLowerCase().includes(p.toLowerCase()))
        if (key) return String(row[key] ?? "").trim() || null
      }
      return null
    }

    const companyName = get(["company", "employer", "firm", "establishment"])
    if (!companyName) continue

    const location = [get(["city"]), get(["state"])].filter(Boolean).join(", ") || get(["address", "location"])
    const noticeDate = parseWarnDate(row[keys.find(k => /date|notice/i.test(k)) ?? ""] ?? "")
    const empRaw = get(["employ", "worker", "affect", "count", "number"])
    const employeesAffected = empRaw ? (Number(empRaw.replace(/[^0-9]/g, "")) || null) : null
    const layoffType = get(["type", "permanent", "temporary", "closing"])

    rows.push({ companyName, location, noticeDate, employeesAffected, layoffType })
  }
  return rows
}

// ── Main import ───────────────────────────────────────────────────────────────

export async function importWarnAct(): Promise<WarnActResult> {
  const result: WarnActResult = { rowsProcessed: 0, newEvents: 0, duplicatesSkipped: 0, matchFailures: 0, errors: [] }
  const pool = getPostgresPool()

  // Fetch the WARN page HTML to find download links
  let fileLinks: string[] = []
  try {
    const pageRes = await fetch(WARN_PAGE, { headers: BROWSER_HEADERS })
    if (!pageRes.ok) {
      result.errors.push(`WARN page fetch failed: ${pageRes.status}`)
      return result
    }
    const html = await pageRes.text()
    fileLinks = extractFileLinks(html)
  } catch (e) {
    result.errors.push(`WARN page unreachable: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }

  if (fileLinks.length === 0) {
    result.errors.push("No WARN data files found on DOL page — page structure may have changed")
    return result
  }

  const affectedCompanyIds = new Set<string>()

  for (const fileUrl of fileLinks) {
    try {
      const fileRes = await fetch(fileUrl, { headers: { ...BROWSER_HEADERS, Accept: "*/*" } })
      if (!fileRes.ok) { result.errors.push(`File fetch failed (${fileRes.status}): ${fileUrl}`); continue }

      const buffer = await fileRes.arrayBuffer()
      const wb = XLSX.read(buffer, { type: "array", cellDates: true })
      const warnRows = parseWarnSheet(wb)

      const BATCH = 50
      for (let i = 0; i < warnRows.length; i += BATCH) {
        const chunk = warnRows.slice(i, i + BATCH)
        const client = await pool.connect()
        try {
          await client.query("BEGIN")
          for (const row of chunk) {
            result.rowsProcessed++
            try {
              if (!row.noticeDate || isNaN(row.noticeDate.getTime())) continue
              const dateStr = row.noticeDate.toISOString().slice(0, 10)

              // Deduplicate: company + date + employees
              const { rows: existing } = await client.query(
                `SELECT id FROM layoff_events
                 WHERE company_name_raw = $1 AND event_date = $2 AND source = 'warn_act'
                   AND COALESCE(employees_affected, 0) = COALESCE($3, 0)
                 LIMIT 1`,
                [row.companyName, dateStr, row.employeesAffected]
              )
              if (existing.length > 0) { result.duplicatesSkipped++; continue }

              const match = await matchCompany({ companyNameRaw: row.companyName, source: "warn_act" })
              if (!match.matched) result.matchFailures++
              if (match.companyId) affectedCompanyIds.add(match.companyId)

              await client.query(
                `INSERT INTO layoff_events
                   (company_id, company_name_raw, source, event_date, employees_affected,
                    location, headline, is_verified)
                 VALUES ($1,$2,'warn_act',$3,$4,$5,$6,true)`,
                [
                  match.companyId,
                  row.companyName,
                  dateStr,
                  row.employeesAffected,
                  row.location,
                  row.layoffType ? `WARN Act: ${row.layoffType}` : "WARN Act notice filed",
                ]
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
    } catch (fileErr) {
      result.errors.push(`File error ${fileUrl}: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`)
    }
  }

  // Recompute summaries
  for (const companyId of affectedCompanyIds) {
    await computeLayoffSummary(companyId).catch(() => {})
  }

  return result
}
