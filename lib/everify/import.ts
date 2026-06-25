import { getPostgresPool, hasPostgresEnv } from "@/lib/postgres/server"
import { normalizeEmployerName } from "@/lib/h1b/normalize-employer"
import { parseEverifyXlsx, type EverifyRow } from "./parser"

// E-Verify list source. USCIS replaced the bulk download with a search tool, so there is
// no stable public URL — configure EVERIFY_LIST_URL (a release/mirror) or pass a buffer
// (manual download). Matching is EXACT normalized-name only: a false E-Verify flag can
// harm a STEM OPT case, so we under-match rather than over-match.
const EVERIFY_LIST_URL = process.env.EVERIFY_LIST_URL ?? null

export interface EverifyImportResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  rows_imported: number
  new_matches: number
  errors: string[]
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "*/*",
    },
    redirect: "follow",
  })
  if (!res.ok) throw new Error(`E-Verify list fetch failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

export async function importEverifyEmployers(
  opts: { buffer?: Buffer; url?: string } = {}
): Promise<EverifyImportResult> {
  const empty: EverifyImportResult = { ok: true, rows_imported: 0, new_matches: 0, errors: [] }
  if (!hasPostgresEnv()) return { ...empty, ok: false, reason: "no_db" }

  const url = opts.url ?? EVERIFY_LIST_URL
  let buffer = opts.buffer
  if (!buffer) {
    if (!url) {
      // No source configured — safe no-op (do NOT flip any flags without authoritative data).
      return { ...empty, skipped: true, reason: "no_source_configured" }
    }
    buffer = await fetchBuffer(url)
  }

  const rows: EverifyRow[] = parseEverifyXlsx(buffer)
  if (rows.length === 0) return { ...empty, errors: ["parsed 0 rows"] }

  const pool = getPostgresPool()

  // 1. Upsert staging (batched).
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const params: unknown[] = []
    const tuples = slice.map((r) => {
      const b = params.length
      params.push(
        r.e_verify_id,
        r.employer_name,
        normalizeEmployerName(r.employer_name),
        r.city,
        r.state,
        r.zip,
        r.industry_naics
      )
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},'enrolled')`
    })
    await pool.query(
      `INSERT INTO e_verify_employers
         (e_verify_id, employer_name, employer_name_norm, city, state, zip, industry_naics, status)
       VALUES ${tuples.join(",")}
       ON CONFLICT (e_verify_id) DO UPDATE SET
         employer_name = EXCLUDED.employer_name,
         employer_name_norm = EXCLUDED.employer_name_norm,
         city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip,
         industry_naics = EXCLUDED.industry_naics, imported_at = NOW()`,
      params
    )
  }

  // 2. Match to companies IN-APP (companies has no normalized-name column). Exact only.
  const { rows: companyRows } = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM companies WHERE is_active = true"
  )
  const byNorm = new Map<string, string | null>() // null = ambiguous
  for (const c of companyRows) {
    const k = normalizeEmployerName(c.name)
    if (!k) continue
    byNorm.set(k, byNorm.has(k) ? null : c.id)
  }
  const { rows: staging } = await pool.query<{ e_verify_id: string; employer_name_norm: string }>(
    "SELECT e_verify_id, employer_name_norm FROM e_verify_employers WHERE matched_company_id IS NULL"
  )
  const matches: Array<[string, string]> = [] // [e_verify_id, company_id]
  for (const s of staging) {
    const cid = byNorm.get(s.employer_name_norm)
    if (cid) matches.push([s.e_verify_id, cid])
  }

  let new_matches = 0
  for (let i = 0; i < matches.length; i += CHUNK) {
    const slice = matches.slice(i, i + CHUNK)
    // Set staging match
    await pool.query(
      `UPDATE e_verify_employers ev SET matched_company_id = m.cid
       FROM (SELECT unnest($1::text[]) AS eid, unnest($2::uuid[]) AS cid) m
       WHERE ev.e_verify_id = m.eid`,
      [slice.map((x) => x[0]), slice.map((x) => x[1])]
    )
    // Flip company flags (only those not already flagged)
    const res = await pool.query(
      `UPDATE companies c
       SET is_e_verify = true, e_verify_company_id = m.eid, e_verify_status = 'enrolled', e_verify_synced_at = NOW()
       FROM (SELECT unnest($1::text[]) AS eid, unnest($2::uuid[]) AS cid) m
       WHERE c.id = m.cid AND c.is_e_verify = false`,
      [slice.map((x) => x[0]), slice.map((x) => x[1])]
    )
    new_matches += res.rowCount ?? 0
  }

  return { ok: true, rows_imported: rows.length, new_matches, errors: [] }
}
