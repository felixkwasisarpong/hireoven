import { parse } from 'csv-parse/sync'
import { createClient } from '@/lib/supabase/server'
import type { Company, CompanyUpdate, H1BRecordInsert } from '@/types'

/**
 * USCIS H-1B Employer Data Hub files are published in a few different shapes:
 *
 *   1. Modern "Crosstab" export from the embedded Tableau dashboard. These
 *      come down as UTF-16 LE with a BOM and tab-delimited fields. Column
 *      names match `Employer (Petitioner) Name`, `New Employment Approval`,
 *      etc., and the data starts at line 2.
 *   2. Older annual CSVs USCIS used to publish directly. Those were UTF-8
 *      and comma-delimited with columns like `Employer`, `Initial Approvals`.
 *
 * This parser auto-detects encoding + delimiter so either shape imports.
 */
function decodeBuffer(buffer: Buffer): string {
  // UTF-16 LE BOM: 0xFF 0xFE
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  // UTF-16 BE BOM: 0xFE 0xFF
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  }
  // UTF-8 BOM: 0xEF 0xBB 0xBF
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.subarray(3).toString('utf8')
  }
  // Heuristic: lots of null bytes in the first few hundred bytes => UTF-16 LE
  // without BOM (some exports from older Tableau versions omit it).
  const sample = buffer.subarray(0, Math.min(buffer.length, 512))
  let nulls = 0
  for (const byte of sample) if (byte === 0) nulls++
  if (nulls > sample.length / 4) {
    return new TextDecoder('utf-16le').decode(buffer)
  }
  return buffer.toString('utf8')
}

/** Detect tab vs comma by counting occurrences in the header row. */
function detectDelimiter(text: string): ',' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const tabs = (firstLine.match(/\t/g) ?? []).length
  const commas = (firstLine.match(/,/g) ?? []).length
  return tabs > commas ? '\t' : ','
}

function normalizeEmployerName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\b(INC|LLC|CORP|CORPORATION|LTD|LIMITED|CO|COMPANY|PLC|HOLDINGS|GROUP|TECHNOLOGIES|TECHNOLOGY|SYSTEMS|SOLUTIONS|SERVICES)\b\.?,?\s*/g, '')
    .replace(/[,.]$/, '')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function fuzzyMatch(employer: string, companyName: string): boolean {
  const a = normalizeEmployerName(employer)
  const b = normalizeEmployerName(companyName)
  if (a === b) return true
  if (a.includes(b) || b.includes(a)) return true
  return levenshtein(a, b) <= Math.floor(Math.max(a.length, b.length) * 0.15)
}

function calcConfidence(total1yr: number, approvalRate: number): number {
  let score = 0
  if (total1yr > 0) score += 50 + 20
  if (approvalRate > 0.8) score += 10
  if (total1yr > 10) score += 10
  if (total1yr > 50) score += 10
  return Math.min(100, score)
}

export type H1BImportResult = {
  processed: number
  matched: number
  skipped: number
  scoresUpdated: number
  unmatchedEmployers: string[]
  /** Total wall-clock import duration in ms. */
  durationMs: number
  /** How many raw rows survived parsing (pre-aggregation). */
  rowsParsed: number
}

export type H1BImportOptions = {
  /** Emits after each flush so callers can surface progress in UIs/logs. */
  onProgress?: (progress: {
    phase: 'parse' | 'aggregate' | 'upsert-records' | 'update-companies' | 'done'
    processed: number
    total: number
  }) => void | Promise<void>
}

/** Columns that sum into the "approved" bucket, across both legacy and
 *  modern USCIS Data Hub exports. */
const APPROVAL_COLUMNS = [
  'Initial Approvals',
  'INITIAL_APPROVALS',
  'New Employment Approval',
  'Continuing Approvals',
  'CONTINUING_APPROVALS',
  'Continuation Approval',
  'Change with Same Employer Approval',
  'New Concurrent Approval',
  'Change of Employer Approval',
  'Amended Approval',
]

const DENIAL_COLUMNS = [
  'Initial Denials',
  'INITIAL_DENIALS',
  'New Employment Denial',
  'Continuation Denial',
  'Change with Same Employer Denial',
  'New Concurrent Denial',
  'Change of Employer Denial',
  'Amended Denial',
]

const EMPLOYER_COLUMNS = [
  'Employer (Petitioner) Name',
  'Employer',
  'EMPLOYER_NAME',
  'Petitioner',
]

const FISCAL_YEAR_COLUMNS = [
  'Fiscal Year',
  'Fiscal Year   ', // Tableau export leaves trailing whitespace in the header
  'FiscalYear',
  'FISCAL_YEAR',
]

const NAICS_COLUMNS = [
  'Industry (NAICS) Code',
  'NAICS',
  'NAICS_CODE',
]

/** Case- and whitespace-insensitive column lookup. */
function pick(row: Record<string, string>, candidates: readonly string[]): string {
  // Fast path: exact match.
  for (const key of candidates) {
    if (key in row) return row[key] ?? ''
  }
  // Loose path: normalise keys once.
  const lut = new Map<string, string>()
  for (const [k, v] of Object.entries(row)) {
    lut.set(k.trim().toLowerCase(), v)
  }
  for (const key of candidates) {
    const v = lut.get(key.trim().toLowerCase())
    if (v !== undefined) return v
  }
  return ''
}

function parseCount(value: string | undefined): number {
  if (!value) return 0
  // Tableau exports numbers like "0.0", "1.0", "12.0". Accept decimals.
  const n = parseFloat(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

export async function importH1BDataFromBuffer(
  input: Buffer | ArrayBuffer | Uint8Array | string,
  options: H1BImportOptions = {}
): Promise<H1BImportResult> {
  const started = Date.now()
  const { onProgress } = options

  const buffer =
    typeof input === 'string'
      ? Buffer.from(input, 'utf8')
      : Buffer.isBuffer(input)
        ? input
        : input instanceof Uint8Array
          ? Buffer.from(input)
          : Buffer.from(new Uint8Array(input))

  const text = decodeBuffer(buffer)
  const delimiter = detectDelimiter(text)

  const rows = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim()),
    skip_empty_lines: true,
    trim: true,
    delimiter,
    relax_column_count: true,
    bom: true,
  }) as Record<string, string>[]

  await onProgress?.({ phase: 'parse', processed: rows.length, total: rows.length })
  console.log(
    `[uscis-import] parsed ${rows.length.toLocaleString()} rows (${delimiter === '\t' ? 'TSV' : 'CSV'}, ${Math.round(buffer.length / 1024)}KB)`
  )

  const supabase = await createClient()
  const { data: companiesData } = await supabase.from('companies').select('id, name')
  if (!companiesData) throw new Error('Could not load companies from database')
  const companies = companiesData as Array<Pick<Company, 'id' | 'name'>>

  // ---------------------------------------------------------------------
  // Step 1 - in-memory aggregation per (employer, fiscal year).
  // ---------------------------------------------------------------------
  const aggregated = new Map<
    string,
    { employer: string; year: number; approvals: number; denials: number; naics: string | null }
  >()

  const fallbackYear = new Date().getFullYear()
  for (const row of rows) {
    const employer = pick(row, EMPLOYER_COLUMNS).trim()
    if (!employer) continue

    const yearRaw = pick(row, FISCAL_YEAR_COLUMNS).trim()
    const year = parseInt(yearRaw, 10) || fallbackYear

    let approvals = 0
    for (const col of APPROVAL_COLUMNS) approvals += parseCount(row[col])
    let denials = 0
    for (const col of DENIAL_COLUMNS) denials += parseCount(row[col])

    if (approvals === 0 && denials === 0) continue

    const naicsRaw = pick(row, NAICS_COLUMNS).trim()
    // Tableau formats NAICS as "54 - Professional, Scientific, and Technical
    // Services" - strip the description so we store just the numeric code.
    const naics = naicsRaw ? naicsRaw.split(/\s*-\s*/)[0].trim() || null : null

    const key = `${employer}__${year}`
    const existing = aggregated.get(key) ?? {
      employer,
      year,
      approvals: 0,
      denials: 0,
      naics,
    }
    aggregated.set(key, {
      employer,
      year,
      approvals: existing.approvals + approvals,
      denials: existing.denials + denials,
      naics: existing.naics ?? naics,
    })
  }

  const total = aggregated.size
  await onProgress?.({ phase: 'aggregate', processed: total, total })
  console.log(`[uscis-import] aggregated into ${total.toLocaleString()} (employer, year) rows`)

  // ---------------------------------------------------------------------
  // Step 2 - fuzzy-match each unique employer to a tracked company. We do
  // this once per employer (not per year) so the O(N·M) cost does not scale
  // with fiscal years.
  // ---------------------------------------------------------------------
  const uniqueEmployers = Array.from(
    new Set(Array.from(aggregated.values()).map((agg) => agg.employer))
  )
  const employerToCompany = new Map<string, Pick<Company, 'id' | 'name'> | null>()
  for (const employer of uniqueEmployers) {
    employerToCompany.set(
      employer,
      companies.find((c) => fuzzyMatch(employer, c.name)) ?? null
    )
  }

  const unmatchedEmployers: string[] = []
  for (const [employer, company] of employerToCompany) {
    if (!company) unmatchedEmployers.push(employer)
  }

  // ---------------------------------------------------------------------
  // Step 3 - batch upsert h1b_records. Requires the unique index on
  // (employer_name, year) defined in schema.sql; without it we fall back
  // to a bulk select-then-split path for old databases.
  // ---------------------------------------------------------------------
  const records: H1BRecordInsert[] = []
  for (const [, agg] of aggregated) {
    const company = employerToCompany.get(agg.employer) ?? null
    records.push({
      company_id: company?.id ?? null,
      employer_name: agg.employer,
      year: agg.year,
      total_petitions: agg.approvals + agg.denials,
      approved: agg.approvals,
      denied: agg.denials,
      initial_approvals: agg.approvals,
      continuing_approvals: 0,
      naics_code: agg.naics,
      raw_data: {
        approvals: agg.approvals,
        denials: agg.denials,
        fiscal_year: agg.year,
      },
    })
  }

  const BATCH = 500
  let upserted = 0
  let upsertFailedWithConflict = false
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH)
    const { error } = await (supabase.from('h1b_records') as any).upsert(chunk, {
      onConflict: 'employer_name,year',
      ignoreDuplicates: false,
    })
    if (error) {
      // 42P10 = there is no unique constraint matching onConflict. Happens on
      // databases that haven't run the new migration yet.
      if (
        (error as { code?: string }).code === '42P10' ||
        /no unique|constraint matching/i.test(error.message ?? '')
      ) {
        upsertFailedWithConflict = true
        break
      }
      throw new Error(`h1b_records upsert failed at batch ${i}: ${error.message}`)
    }
    upserted += chunk.length
    await onProgress?.({
      phase: 'upsert-records',
      processed: upserted,
      total: records.length,
    })
    if (upserted % 5000 === 0 || upserted === records.length) {
      console.log(`[uscis-import] upserted ${upserted.toLocaleString()}/${records.length.toLocaleString()} records`)
    }
  }

  // Legacy fallback - bulk select, split, batch insert+update.
  if (upsertFailedWithConflict) {
    console.log(
      '[uscis-import] unique index missing on (employer_name, year); falling back to select+split path'
    )
    const existingByKey = new Map<string, string>()
    const employerChunks: string[][] = []
    for (let i = 0; i < uniqueEmployers.length; i += 500) {
      employerChunks.push(uniqueEmployers.slice(i, i + 500))
    }
    for (const chunk of employerChunks) {
      const { data } = await supabase
        .from('h1b_records')
        .select('id, employer_name, year')
        .in('employer_name', chunk)
      for (const row of (data ?? []) as Array<{ id: string; employer_name: string; year: number }>) {
        existingByKey.set(`${row.employer_name}__${row.year}`, row.id)
      }
    }

    const toInsert: H1BRecordInsert[] = []
    const toUpdate: Array<H1BRecordInsert & { id: string }> = []
    for (const r of records) {
      const existingId = existingByKey.get(`${r.employer_name}__${r.year}`)
      if (existingId) {
        toUpdate.push({ ...r, id: existingId })
      } else {
        toInsert.push(r)
      }
    }

    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH)
      const { error } = await (supabase.from('h1b_records') as any).insert(chunk)
      if (error) throw new Error(`h1b_records insert failed at batch ${i}: ${error.message}`)
      upserted += chunk.length
      await onProgress?.({
        phase: 'upsert-records',
        processed: upserted,
        total: records.length,
      })
    }
    // Updates have to stay per-row since each gets a different payload +
    // primary key. They run in parallel in small waves to stay fast.
    const CONCURRENCY = 10
    for (let i = 0; i < toUpdate.length; i += CONCURRENCY) {
      const wave = toUpdate.slice(i, i + CONCURRENCY)
      await Promise.all(
        wave.map(async ({ id, ...payload }) => {
          const { error } = await (supabase.from('h1b_records') as any)
            .update(payload)
            .eq('id', id)
          if (error) throw new Error(`h1b_records update ${id} failed: ${error.message}`)
        })
      )
      upserted += wave.length
      if (i % 500 === 0) {
        await onProgress?.({
          phase: 'upsert-records',
          processed: upserted,
          total: records.length,
        })
      }
    }
  }

  // ---------------------------------------------------------------------
  // Step 4 - per-company sponsorship snapshot using the most recent fiscal
  // year we have per employer. One batched update per company.
  // ---------------------------------------------------------------------
  const perCompany = new Map<
    string,
    { approvals: number; denials: number; year: number }
  >()
  for (const [, agg] of aggregated) {
    const company = employerToCompany.get(agg.employer)
    if (!company) continue
    const existing = perCompany.get(company.id)
    if (!existing || agg.year > existing.year) {
      perCompany.set(company.id, {
        approvals: agg.approvals,
        denials: agg.denials,
        year: agg.year,
      })
    }
  }

  let scoresUpdated = 0
  const companyIds = Array.from(perCompany.keys())
  const COMPANY_CONCURRENCY = 10
  for (let i = 0; i < companyIds.length; i += COMPANY_CONCURRENCY) {
    const wave = companyIds.slice(i, i + COMPANY_CONCURRENCY)
    await Promise.all(
      wave.map(async (companyId) => {
        const snap = perCompany.get(companyId)!
        const totalPetitions = snap.approvals + snap.denials
        const approvalRate = totalPetitions > 0 ? snap.approvals / totalPetitions : 0
        const update: CompanyUpdate = {
          h1b_sponsor_count_1yr: snap.approvals,
          sponsors_h1b: snap.approvals > 0,
          sponsorship_confidence: calcConfidence(snap.approvals, approvalRate),
        }
        const { error } = await (supabase.from('companies') as any)
          .update(update)
          .eq('id', companyId)
        if (!error) scoresUpdated++
      })
    )
    await onProgress?.({
      phase: 'update-companies',
      processed: Math.min(i + COMPANY_CONCURRENCY, companyIds.length),
      total: companyIds.length,
    })
  }

  const durationMs = Date.now() - started
  await onProgress?.({ phase: 'done', processed: total, total })
  console.log(
    `[uscis-import] done in ${(durationMs / 1000).toFixed(1)}s - ` +
      `${total.toLocaleString()} records, ${perCompany.size.toLocaleString()} companies updated, ` +
      `${unmatchedEmployers.length.toLocaleString()} unmatched`
  )

  return {
    processed: total,
    matched: perCompany.size,
    skipped: unmatchedEmployers.length,
    scoresUpdated,
    unmatchedEmployers: unmatchedEmployers.slice(0, 200),
    durationMs,
    rowsParsed: rows.length,
  }
}
