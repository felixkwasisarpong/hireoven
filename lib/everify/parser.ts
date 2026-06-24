import * as XLSX from "xlsx"
import { createHash } from "node:crypto"

// USCIS publishes the participating-employers list as an Excel file (columns vary by
// release; the public list is typically Employer Name / City / State / ZIP / NAICS,
// sometimes without a stable participant ID). We detect columns by header alias and
// synthesize a stable id when none is present.

export interface EverifyRow {
  e_verify_id: string
  employer_name: string
  city: string | null
  state: string | null
  zip: string | null
  industry_naics: string | null
}

const ALIASES = {
  id: ["e-verify id", "everify id", "participant id", "company id", "id"],
  name: ["employer name", "company name", "name", "legal business name", "business name"],
  city: ["city"],
  state: ["state"],
  zip: ["zip", "zip code", "zipcode", "postal code"],
  naics: ["naics", "naics code", "industry"],
}

function headerIndex(header: string[], aliases: string[]): number {
  const norm = header.map((h) => String(h ?? "").trim().toLowerCase())
  for (const a of aliases) {
    const i = norm.indexOf(a)
    if (i >= 0) return i
  }
  return -1
}

function synthId(name: string, city: string | null, state: string | null): string {
  return "syn_" + createHash("sha1").update(`${name}|${city ?? ""}|${state ?? ""}`.toLowerCase()).digest("hex").slice(0, 20)
}

export function parseEverifyXlsx(buffer: ArrayBuffer | Uint8Array | Buffer): EverifyRow[] {
  const wb = XLSX.read(buffer, { type: "buffer" })
  const out: EverifyRow[] = []
  for (const sheetName of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName], { header: 1, blankrows: false })
    if (aoa.length < 2) continue
    // Find the header row (first row naming an employer-name column).
    let headerRow = -1
    for (let i = 0; i < Math.min(aoa.length, 10); i++) {
      if (headerIndex(aoa[i] ?? [], ALIASES.name) >= 0) {
        headerRow = i
        break
      }
    }
    if (headerRow < 0) continue
    const header = aoa[headerRow]
    const ix = {
      id: headerIndex(header, ALIASES.id),
      name: headerIndex(header, ALIASES.name),
      city: headerIndex(header, ALIASES.city),
      state: headerIndex(header, ALIASES.state),
      zip: headerIndex(header, ALIASES.zip),
      naics: headerIndex(header, ALIASES.naics),
    }
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const row = aoa[r] ?? []
      const name = String(row[ix.name] ?? "").trim()
      if (!name) continue
      const city = ix.city >= 0 ? String(row[ix.city] ?? "").trim() || null : null
      const state = ix.state >= 0 ? String(row[ix.state] ?? "").trim().toUpperCase().slice(0, 2) || null : null
      const zip = ix.zip >= 0 ? String(row[ix.zip] ?? "").trim() || null : null
      const naics = ix.naics >= 0 ? String(row[ix.naics] ?? "").trim() || null : null
      const rawId = ix.id >= 0 ? String(row[ix.id] ?? "").trim() : ""
      out.push({
        e_verify_id: rawId || synthId(name, city, state),
        employer_name: name,
        city,
        state,
        zip,
        industry_naics: naics,
      })
    }
    if (out.length > 0) break // first sheet with data wins
  }
  return out
}
