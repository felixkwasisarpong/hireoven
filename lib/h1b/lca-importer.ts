/**
 * DOL LCA data importer.
 *
 * Feeds `lca_records` from a DOL public-disclosure Excel file
 * (https://www.dol.gov/agencies/eta/foreign-labor/performance) and rebuilds
 * the aggregated `employer_lca_stats` table used by the prediction engine.
 *
 * IMPORTANT: This module is a **pure data loader**. It does NOT create
 * rows in the `companies` table. Unmatched employers are stored with
 * `lca_records.company_id = null`; a dedicated reconciliation script —
 * `scripts/reconcile-companies-from-imports.ts` — is the single authoritative
 * path for turning unmatched employers into placeholder `companies` rows.
 * See `lib/companies/placeholder-from-employer.ts` for that logic.
 *
 * Column headers vary by fiscal year. We handle every known variant we
 * have seen since FY2019.
 */

import * as XLSX from 'xlsx'
import { parse as parseCSV } from 'csv-parse/sync'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  Company,
  EmployerLCAStats,
  LCARecordInsert,
  TopJobTitle,
  TopState,
  WageLevelStat,
  YearStat,
} from '@/types'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ImportPhase =
  | 'parse'
  | 'match'
  | 'insert'
  | 'aggregate'
  | 'done'

export type ImportProgress = {
  phase: ImportPhase
  processed: number
  total: number
  /** rows successfully inserted so far (cumulative across the whole import) */
  inserted: number
  /** best-effort human-readable note ("Parsed sheet 'Q1' row 3", etc.) */
  message?: string
}

export type ImportResult = {
  rowsProcessed: number
  rowsInserted: number
  rowsSkipped: number // duplicates or malformed
  companiesMatched: number
  companiesUnmatched: number
  errors: string[]
  duration: number
}

export type ImportOptions = {
  /** Fiscal year hint if the file itself does not disclose it. */
  fiscalYear?: number
  /** Optional progress callback. Emits after each batch is flushed. */
  onProgress?: (progress: ImportProgress) => void | Promise<void>
}

/** Import from a Buffer / ArrayBuffer / Uint8Array. */
export async function importLCAData(
  input: ArrayBuffer | Uint8Array | Buffer,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const started = Date.now()
  const { fiscalYear, onProgress } = options
  const errors: string[] = []

  const emit = async (p: Omit<ImportProgress, 'inserted'> & { inserted?: number }) => {
    if (!onProgress) return
    await onProgress({ inserted: 0, ...p })
  }

  // xlsx is finicky about input types in Node. Normalise to a Buffer —
  // we'll either hand it to XLSX.read with type: 'buffer' (xlsx/xls path)
  // or decode as text and parse as CSV/TSV.
  const bytes = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
    ? Buffer.from(input)
    : Buffer.from(new Uint8Array(input))

  const fileKind = sniffFileKind(bytes)

  // DOL LCA disclosures frequently bury the real header row under a title
  // banner, a disclaimer, or merged cells. Whichever loader runs below, it
  // produces an AoA (array-of-arrays) that `locateHeaderRow` can scan for
  // the first row naming one of our known employer/case columns.
  const { rawRows, sheetUsed, headerRowIndex, detectedFormat, inspected } =
    fileKind === 'csv'
      ? loadLCARowsFromCSV(bytes)
      : loadLCARowsFromXLSX(bytes)
  if (rawRows.length === 0) {
    // For XLSX we may have opened multiple sheets; for CSV there is only
    // one logical "sheet" and `inspected` carries that single entry.
    const sheetNames = inspected.map((s) => s.sheet)

    // Always dump the full diagnostic to the server console so the user
    // can copy it straight out of their `npm run dev` terminal — toasts
    // and HTTP error bodies truncate long multi-line strings.
    console.error(
      '[lca-import] header detection FAILED',
      JSON.stringify(
        {
          sheetNamesInWorkbook: sheetNames,
          detectedFormat,
          inspected,
        },
        null,
        2
      )
    )

    if (detectedFormat === 'uscis') {
      throw new Error(
        `This looks like a USCIS H-1B Employer Data Hub crosstab (columns like ` +
          `"Employer (Petitioner) Name", "Initial/Continuing Approvals", "Tax ID", ` +
          `"NAICS"), not a DOL LCA disclosure file. Upload it via the "Import ` +
          `USCIS CSV" panel instead — that parser understands this exact layout.`
      )
    }

    const diag = inspected
      .map((s) => {
        const previews = s.firstFewRows
          .map(
            (row, i) =>
              `    row ${i + 1}: [${row
                .filter((c) => c !== '')
                .slice(0, 8)
                .join(' | ')}]`
          )
          .join('\n')
        return `  • "${s.sheet}" (${s.totalRows} rows)\n${previews || '    (empty)'}`
      })
      .join('\n')

    throw new Error(
      `No header row matched. Checked ${sheetNames.length} sheet(s) [${sheetNames.join(', ')}]; ` +
        `scanned the first 20 rows of each for columns like EMPLOYER_NAME / ` +
        `CASE_NUMBER / CASE_STATUS / VISA_CLASS / JOB_TITLE.\n\n` +
        (diag
          ? `What the parser saw:\n${diag}\n\n`
          : `The parser could not open any sheet — check the dev server terminal for '[lca-import] header detection FAILED' details.\n\n`) +
        `If the header row is visible above but not matching, share one of ` +
        `the column names we missed and we'll add it as an alias. If these ` +
        `rows look empty or truncated, re-save the file as .xlsx from Excel ` +
        `(File → Save As → Excel Workbook) and try again.`
    )
  }
  errors.push(
    `Parsed sheet "${sheetUsed}" with header on row ${headerRowIndex + 1}.`
  )
  await emit({
    phase: 'parse',
    processed: rawRows.length,
    total: rawRows.length,
    message: `Parsed "${sheetUsed}" header row ${headerRowIndex + 1} (${rawRows.length.toLocaleString()} rows)`,
  })

  let rowsProcessed = 0
  let rowsInserted = 0
  let rowsSkipped = 0

  const supabase = createAdminClient()

  // Pull existing companies once so we can attach `company_id` where a
  // normalised name already matches a tracked company. We NEVER insert into
  // `companies` from this importer — unmatched employers stay with
  // `company_id = null` and are reconciled later by
  // `scripts/reconcile-companies-from-imports.ts`.
  const { data: companyRows, error: companyError } = await supabase
    .from('companies')
    .select('id, name, domain')

  if (companyError) {
    throw new Error(`Failed to load companies: ${companyError.message}`)
  }

  const companiesIndex = buildCompanyIndex(
    (companyRows ?? []) as Pick<Company, 'id' | 'name' | 'domain'>[]
  )
  const matchedEmployerIds = new Set<string>()
  const unmatchedEmployerKeys = new Set<string>()

  const BATCH_SIZE = 1000
  let batch: LCARecordInsert[] = []

  async function flush(): Promise<void> {
    if (batch.length === 0) return
    // onConflict uses (source_case_number, fiscal_year) uniqueness defined in
    // the schema. Rows without a case number fall back to plain insert.
    const withCase = batch.filter((r) => r.source_case_number)
    const withoutCase = batch.filter((r) => !r.source_case_number)

    if (withCase.length > 0) {
      const { error } = await supabase
        .from('lca_records')
        .upsert(withCase as never, {
          onConflict: 'source_case_number,fiscal_year',
          ignoreDuplicates: true,
        })
      if (error) {
        errors.push(`batch upsert: ${error.message}`)
      } else {
        rowsInserted += withCase.length
      }
    }

    if (withoutCase.length > 0) {
      const { error } = await supabase
        .from('lca_records')
        .insert(withoutCase as never)
      if (error) {
        errors.push(`batch insert: ${error.message}`)
      } else {
        rowsInserted += withoutCase.length
      }
    }

    batch = []
    await emit({
      phase: 'insert',
      processed: rowsProcessed,
      total: rawRows.length,
      inserted: rowsInserted,
    })
  }

  for (const row of rawRows) {
    rowsProcessed++
    const normalized = normalizeLCARow(row, fiscalYear)
    if (!normalized) {
      rowsSkipped++
      continue
    }

    // Attach company_id only if the normalised name already matches an
    // existing tracked company. Never auto-create here.
    const companyId = companiesIndex.byNormalized.get(
      normalized.employer_name_normalized!
    )
    if (companyId) {
      matchedEmployerIds.add(companyId)
      normalized.company_id = companyId
    } else {
      unmatchedEmployerKeys.add(normalized.employer_name_normalized!)
    }

    batch.push(normalized)
    if (batch.length >= BATCH_SIZE) {
      await flush()
    }
  }

  await flush()

  // Rebuild aggregated stats once all rows are in.
  await emit({
    phase: 'aggregate',
    processed: rowsProcessed,
    total: rawRows.length,
    inserted: rowsInserted,
    message: 'Rebuilding employer_lca_stats',
  })
  try {
    await rebuildEmployerStats()
  } catch (err) {
    errors.push(`rebuildEmployerStats: ${(err as Error).message}`)
  }

  await emit({
    phase: 'match',
    processed: rowsProcessed,
    total: rawRows.length,
    inserted: rowsInserted,
    message: 'Back-linking lca_records to existing companies',
  })
  try {
    await matchLCAToCompanies()
  } catch (err) {
    errors.push(`matchLCAToCompanies: ${(err as Error).message}`)
  }

  await emit({
    phase: 'aggregate',
    processed: rowsProcessed,
    total: rawRows.length,
    inserted: rowsInserted,
    message: 'Rebuilding SOC base rates',
  })
  try {
    await rebuildSOCBaseRates()
  } catch (err) {
    errors.push(`rebuildSOCBaseRates: ${(err as Error).message}`)
  }

  await emit({
    phase: 'done',
    processed: rowsProcessed,
    total: rawRows.length,
    inserted: rowsInserted,
  })

  return {
    rowsProcessed,
    rowsInserted,
    rowsSkipped,
    companiesMatched: matchedEmployerIds.size,
    companiesUnmatched: unmatchedEmployerKeys.size,
    errors,
    duration: Date.now() - started,
  }
}

// ---------------------------------------------------------------------------
// Workbook → rows (header auto-detect)
// ---------------------------------------------------------------------------

/**
 * Column names we *must* see before treating a row as the header. Any one
 * of these is enough to lock in; they are stable across every DOL LCA FY we
 * support. Matching is case-insensitive and ignores whitespace/underscores.
 */
const HEADER_SIGNATURE_TOKENS = [
  'CASENUMBER',
  'CASENO',
  'CASESTATUS',
  'EMPLOYERNAME',
  'LCACASENUMBER',
  'LCAEMPLOYERNAME',
  'CASEEMPLOYERNAME',
  'JOBTITLE',
  'VISACLASS',
]

/**
 * Tokens that strongly indicate a USCIS H-1B Employer Data Hub crosstab —
 * **not** a DOL LCA disclosure. We use this to produce a more helpful error
 * when the user uploads the wrong file to the LCA panel.
 */
const USCIS_SIGNATURE_TOKENS = [
  'EMPLOYERPETITIONERNAME',
  'PETITIONERNAME',
  'INITIALAPPROVAL',
  'INITIALAPPROVALS',
  'INITIALDENIAL',
  'INITIALDENIALS',
  'CONTINUINGAPPROVAL',
  'CONTINUINGAPPROVALS',
  'CONTINUATIONAPPROVAL',
  'CONTINUATIONDENIAL',
  'NEWEMPLOYMENTAPPROVAL',
  'NEWEMPLOYMENTDENIAL',
  'CHANGEOFEMPLOYERAPPROVAL',
  'AMENDEDAPPROVAL',
  'TAXID',
  'PETITIONERCITY',
  'PETITIONERSTATE',
  'INDUSTRYNAICSCODE',
]

function canonicaliseHeaderCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * Walk every sheet (skipping obvious metadata sheets) and look for the
 * first row that names at least one known LCA column. Once found, rebuild
 * records using that row as the header — everything above is discarded as
 * title / disclaimer / merged-cell banner, everything below is data.
 *
 * Falls back to "first non-metadata sheet, row 0" if nothing matches —
 * which preserves the historical behaviour for perfectly-formatted files.
 */
export type LoadLCARowsResult = {
  rawRows: Record<string, unknown>[]
  sheetUsed: string
  headerRowIndex: number
  detectedFormat: 'lca' | 'uscis' | 'unknown'
  /** Diagnostic trail — emitted when detection fails so the UI can surface
   *  "we saw columns X, Y, Z on sheet 'Sheet1' row 1" and the user can tell
   *  whether the file is genuinely malformed or the parser is missing an
   *  alias. One entry per sheet that was inspected. */
  inspected: Array<{
    sheet: string
    totalRows: number
    firstFewRows: Array<Array<string>>
  }>
}

/** Return 'csv' for text-looking bytes (CSV/TSV), 'xlsx' otherwise. */
function sniffFileKind(bytes: Buffer): 'csv' | 'xlsx' {
  // .xlsx is a ZIP archive, always starts with "PK" (0x50 0x4B).
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx'
  // .xls (old OLE Compound File) starts with D0 CF 11 E0 A1 B1 1A E1.
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return 'xlsx'
  }
  return 'csv'
}

/** Decode bytes to a UTF-16-aware string (BOM + null-byte heuristic). */
function decodeText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buffer.subarray(2))
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buffer.subarray(2))
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.subarray(3).toString('utf8')
  }
  // Null-byte heuristic for BOM-less UTF-16 LE.
  const sample = buffer.subarray(0, Math.min(buffer.length, 512))
  let nulls = 0
  for (const byte of sample) if (byte === 0) nulls++
  if (nulls > sample.length / 4) {
    return new TextDecoder('utf-16le').decode(buffer)
  }
  return buffer.toString('utf8')
}

/** Detect tab vs comma vs semicolon from the header line. */
function detectDelimiter(text: string): ',' | '\t' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const counts: Array<{ d: ',' | '\t' | ';'; n: number }> = [
    { d: '\t', n: (firstLine.match(/\t/g) ?? []).length },
    { d: ',', n: (firstLine.match(/,/g) ?? []).length },
    { d: ';', n: (firstLine.match(/;/g) ?? []).length },
  ]
  counts.sort((a, b) => b.n - a.n)
  return counts[0].n > 0 ? counts[0].d : ','
}

/**
 * Scan an AoA (array-of-arrays) for the first row whose columns name at
 * least one known LCA signature token, then return the rebuilt rows. This
 * is shared by the xlsx and csv/tsv loaders.
 */
function locateHeaderRow(
  aoa: unknown[][],
  sheetLabel: string,
  inspected: LoadLCARowsResult['inspected']
): LoadLCARowsResult | null {
  if (aoa.length === 0) {
    inspected.push({ sheet: sheetLabel, totalRows: 0, firstFewRows: [] })
    return null
  }

  inspected.push({
    sheet: sheetLabel,
    totalRows: aoa.length,
    firstFewRows: aoa.slice(0, 5).map((row) =>
      (row ?? [])
        .slice(0, 12)
        .map((cell) => (cell == null ? '' : String(cell).slice(0, 40)))
    ),
  })

  const scanLimit = Math.min(20, aoa.length)
  let sawUscisShape = false
  for (let rowIdx = 0; rowIdx < scanLimit; rowIdx++) {
    const cells = aoa[rowIdx] ?? []
    const canonical = cells.map(canonicaliseHeaderCell)
    const matches = canonical.some((c) => HEADER_SIGNATURE_TOKENS.includes(c))
    if (!matches) {
      if (canonical.some((c) => USCIS_SIGNATURE_TOKENS.includes(c))) {
        sawUscisShape = true
      }
      continue
    }

    const headers = cells.map((c) => (c == null ? '' : String(c).trim()))
    const dataRows = aoa.slice(rowIdx + 1)
    const out: Record<string, unknown>[] = []
    for (const row of dataRows) {
      if (!Array.isArray(row)) continue
      if (row.every((v) => v === null || v === undefined || v === '')) continue
      const obj: Record<string, unknown> = {}
      for (let i = 0; i < headers.length; i++) {
        const key = headers[i]
        if (!key) continue
        obj[key] = row[i] ?? null
      }
      out.push(obj)
    }
    return {
      rawRows: out,
      sheetUsed: sheetLabel,
      headerRowIndex: rowIdx,
      detectedFormat: 'lca',
      inspected,
    }
  }

  if (sawUscisShape) {
    return {
      rawRows: [],
      sheetUsed: sheetLabel,
      headerRowIndex: 0,
      detectedFormat: 'uscis',
      inspected,
    }
  }
  return null
}

function loadLCARowsFromXLSX(bytes: Buffer): LoadLCARowsResult {
  const workbook = XLSX.read(bytes, {
    type: 'buffer',
    cellDates: false,
    dense: false,
  })
  if (workbook.SheetNames.length === 0) {
    throw new Error('Workbook contains no sheets')
  }

  const missingSheetKeys = workbook.SheetNames.filter((n) => !workbook.Sheets[n])
  if (missingSheetKeys.length > 0) {
    console.error(
      '[lca-import] WARNING: workbook.SheetNames lists sheets that are not in workbook.Sheets',
      {
        sheetNames: workbook.SheetNames,
        sheetsKeys: Object.keys(workbook.Sheets),
        missingSheetKeys,
        inputBytes: bytes.length,
      }
    )
  }

  const candidateSheets = workbook.SheetNames.filter(
    (n) => !/lookup|schema|readme|notes?|metadata|about/i.test(n)
  )
  const sheetsToTry =
    candidateSheets.length > 0 ? candidateSheets : workbook.SheetNames

  const inspected: LoadLCARowsResult['inspected'] = []
  for (const name of sheetsToTry) {
    const sheet = workbook.Sheets[name]
    if (!sheet) {
      inspected.push({
        sheet: `${name} [MISSING — workbook.Sheets['${name}'] is undefined; xlsx could not decode the sheet's data from the file zip]`,
        totalRows: -1,
        firstFewRows: [],
      })
      continue
    }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      raw: false,
      blankrows: false,
    })
    const match = locateHeaderRow(aoa, name, inspected)
    if (match) return match
  }

  // Last-ditch fallback: xlsx's own header inference on the first sheet.
  const firstName = sheetsToTry[0] ?? workbook.SheetNames[0]!
  const firstSheet = workbook.Sheets[firstName]
  const fallback = firstSheet
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: null,
        raw: false,
      })
    : []
  let sawUscisShape = false
  if (fallback.length > 0) {
    const keys = Object.keys(fallback[0] as Record<string, unknown>)
    if (
      keys.some((k) => USCIS_SIGNATURE_TOKENS.includes(canonicaliseHeaderCell(k)))
    ) {
      sawUscisShape = true
    }
  }
  return {
    rawRows: sawUscisShape ? [] : fallback,
    sheetUsed: firstName,
    headerRowIndex: 0,
    detectedFormat: sawUscisShape ? 'uscis' : 'unknown',
    inspected,
  }
}

function loadLCARowsFromCSV(bytes: Buffer): LoadLCARowsResult {
  const text = decodeText(bytes)
  const delimiter = detectDelimiter(text)
  // relax_column_count + skip_empty_lines keeps us tolerant of trailing
  // commas, ragged rows, and the odd blank line between header banners
  // and data — all common in DOL's CSV exports.
  const rows = parseCSV(text, {
    columns: false,
    delimiter,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  }) as unknown[][]

  const inspected: LoadLCARowsResult['inspected'] = []
  const label = `csv (delimiter="${delimiter === '\t' ? 'TAB' : delimiter}")`
  const match = locateHeaderRow(rows, label, inspected)
  if (match) return match
  // Nothing matched — return what we saw so the caller can surface diagnostics.
  const last = inspected[inspected.length - 1]
  return {
    rawRows: [],
    sheetUsed: last?.sheet ?? label,
    headerRowIndex: 0,
    detectedFormat: 'unknown',
    inspected,
  }
}

// ---------------------------------------------------------------------------
// Row normalisation
// ---------------------------------------------------------------------------

/** Column aliases seen across FY2019–FY2024 DOL LCA disclosures. */
const FIELD_ALIASES = {
  caseNumber: ['CASE_NUMBER', 'CASE_NO', 'LCA_CASE_NUMBER'],
  caseStatus: ['CASE_STATUS', 'STATUS'],
  employerName: ['EMPLOYER_NAME', 'CASE_EMPLOYER_NAME', 'LCA_EMPLOYER_NAME'],
  jobTitle: ['JOB_TITLE', 'LCA_JOB_TITLE'],
  socCode: ['SOC_CODE', 'SOC_CODE_OCCUPATION', 'LCA_SOC_CODE'],
  socTitle: ['SOC_TITLE', 'SOC_NAME', 'LCA_SOC_TITLE'],
  worksiteCity: ['WORKSITE_CITY', 'WORKSITE_CITY_1', 'WORK_CITY'],
  worksiteState: [
    'WORKSITE_STATE',
    'WORKSITE_STATE_1',
    'WORK_STATE',
    'EMPLOYER_STATE',
  ],
  wageFrom: [
    'WAGE_RATE_OF_PAY_FROM',
    'WAGE_FROM',
    'WAGE_RATE_OF_PAY_FROM_1',
    'WAGE_AMT',
  ],
  wageTo: ['WAGE_RATE_OF_PAY_TO', 'WAGE_TO', 'WAGE_RATE_OF_PAY_TO_1'],
  wageUnit: ['WAGE_UNIT_OF_PAY', 'WAGE_UNIT', 'WAGE_UNIT_OF_PAY_1'],
  prevailingWage: [
    'PREVAILING_WAGE',
    'PREVAILING_WAGE_1',
    'PW_WAGE',
    'PW_1',
  ],
  prevailingWageUnit: [
    'PW_UNIT_OF_PAY',
    'PW_UNIT_OF_PAY_1',
    'PREVAILING_WAGE_UNIT',
  ],
  wageLevel: ['WAGE_LEVEL', 'PW_WAGE_LEVEL', 'PW_WAGE_LEVEL_1'],
  decisionDate: ['DECISION_DATE', 'CASE_DECISION_DATE'],
  startDate: ['EMPLOYMENT_START_DATE', 'BEGIN_DATE'],
  endDate: ['EMPLOYMENT_END_DATE', 'END_DATE'],
  fullTime: ['FULL_TIME_POSITION', 'FULL_TIME'],
  naicsCode: ['NAICS_CODE', 'EMPLOYER_NAICS', 'NAICS'],
  visaClass: ['VISA_CLASS'],
  receivedDate: ['CASE_RECEIVED_DATE', 'RECEIVED_DATE'],
} as const

function pick(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = row[k]
    if (v === null || v === undefined) continue
    const str = String(v).trim()
    if (str) return str
  }
  return null
}

function toNumber(value: string | null): number | null {
  if (!value) return null
  const n = Number(String(value).replace(/[$,]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

function toDate(value: string | null): string | null {
  if (!value) return null
  // Excel may feed us "2023-10-01", "10/01/2023", or "10/1/23".
  const trimmed = value.trim()
  if (!trimmed) return null
  const direct = new Date(trimmed)
  if (Number.isFinite(direct.getTime())) {
    return direct.toISOString().slice(0, 10)
  }
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (match) {
    const [, mm, dd, yyRaw] = match
    const yy = yyRaw.length === 2 ? 2000 + Number(yyRaw) : Number(yyRaw)
    const d = new Date(Date.UTC(yy, Number(mm) - 1, Number(dd)))
    if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10)
  }
  return null
}

function toBoolean(value: string | null): boolean | null {
  if (!value) return null
  const v = value.toLowerCase().trim()
  if (v === 'y' || v === 'yes' || v === 'true' || v === '1') return true
  if (v === 'n' || v === 'no' || v === 'false' || v === '0') return false
  return null
}

function stateAbbr(value: string | null): string | null {
  if (!value) return null
  const v = value.trim().toUpperCase()
  if (v.length === 2) return v
  const abbr = US_STATE_NAME_TO_ABBR[v]
  return abbr ?? null
}

export function normalizeEmployerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(
      /\b(incorporated|inc|llc|l\.l\.c|corp|corporation|ltd|limited|co|company|plc|holdings|group)\b/g,
      ''
    )
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeLCARow(
  row: Record<string, unknown>,
  fiscalYearHint?: number
): LCARecordInsert | null {
  const employer = pick(row, FIELD_ALIASES.employerName)
  if (!employer) return null
  const status = pick(row, FIELD_ALIASES.caseStatus)
  if (!status) return null

  const decisionDate = toDate(pick(row, FIELD_ALIASES.decisionDate))
  let fiscalYear: number | null = fiscalYearHint ?? null
  if (!fiscalYear && decisionDate) {
    // Federal FY is Oct 1 → Sep 30.
    const d = new Date(decisionDate)
    const month = d.getUTCMonth() + 1
    const year = d.getUTCFullYear()
    fiscalYear = month >= 10 ? year + 1 : year
  }

  const employer_name_normalized = normalizeEmployerName(employer)
  if (!employer_name_normalized) return null

  const state = pick(row, FIELD_ALIASES.worksiteState)

  return {
    employer_name: employer,
    employer_name_normalized,
    company_id: null,
    job_title: pick(row, FIELD_ALIASES.jobTitle),
    soc_code: pick(row, FIELD_ALIASES.socCode),
    soc_title: pick(row, FIELD_ALIASES.socTitle),
    worksite_city: pick(row, FIELD_ALIASES.worksiteCity),
    worksite_state: state,
    worksite_state_abbr: stateAbbr(state),
    wage_rate_from: toNumber(pick(row, FIELD_ALIASES.wageFrom)),
    wage_rate_to: toNumber(pick(row, FIELD_ALIASES.wageTo)),
    wage_unit: pick(row, FIELD_ALIASES.wageUnit),
    prevailing_wage: toNumber(pick(row, FIELD_ALIASES.prevailingWage)),
    prevailing_wage_unit: pick(row, FIELD_ALIASES.prevailingWageUnit),
    wage_level: pick(row, FIELD_ALIASES.wageLevel),
    case_status: status,
    decision_date: decisionDate,
    visa_class: pick(row, FIELD_ALIASES.visaClass) ?? 'H-1B',
    employment_start_date: toDate(pick(row, FIELD_ALIASES.startDate)),
    employment_end_date: toDate(pick(row, FIELD_ALIASES.endDate)),
    full_time_position: toBoolean(pick(row, FIELD_ALIASES.fullTime)),
    naics_code: pick(row, FIELD_ALIASES.naicsCode),
    fiscal_year: fiscalYear,
    source_case_number: pick(row, FIELD_ALIASES.caseNumber),
  }
}

// ---------------------------------------------------------------------------
// Company matching / auto-creation
// ---------------------------------------------------------------------------

type CompanyIndex = {
  byNormalized: Map<string, string>
  byLooseName: Map<string, string>
  allCompanies: Array<Pick<Company, 'id' | 'name' | 'domain'>>
}

function buildCompanyIndex(
  companies: Array<Pick<Company, 'id' | 'name' | 'domain'>>
): CompanyIndex {
  const byNormalized = new Map<string, string>()
  const byLooseName = new Map<string, string>()
  for (const c of companies) {
    const norm = normalizeEmployerName(c.name)
    if (norm && !byNormalized.has(norm)) {
      byNormalized.set(norm, c.id)
    }
    const loose = c.name.toLowerCase().trim()
    if (loose && !byLooseName.has(loose)) {
      byLooseName.set(loose, c.id)
    }
  }
  return { byNormalized, byLooseName, allCompanies: companies }
}

// Placeholder company creation lives in
// `lib/companies/placeholder-from-employer.ts` and is only ever invoked by
// `scripts/reconcile-companies-from-imports.ts`. The importer above never
// mutates the `companies` table.

// ---------------------------------------------------------------------------
// Aggregate stats rebuild
// ---------------------------------------------------------------------------

const STAFFING_PATTERNS =
  /\b(staffing|staff|recruit|talent|workforce|placement|consulting|consultants|solutions|services|technologies|systems|outsourcing|sourcing|infotech|softech)\b/i

const CONSULTING_PATTERNS = /\b(consulting|consultants|advisory)\b/i

export async function rebuildEmployerStats(): Promise<void> {
  const supabase = createAdminClient()

  // Pull everything we need in one streaming-ish pass. For large datasets we
  // page in 10k chunks so we never exceed Supabase row limits.
  const byEmployer = new Map<
    string,
    {
      display: string
      companyId: string | null
      rows: Array<{
        status: string | null
        year: number | null
        wageLevel: string | null
        jobTitle: string | null
        soc: string | null
        state: string | null
      }>
    }
  >()

  let offset = 0
  const pageSize = 10_000
  while (true) {
    const { data, error } = await supabase
      .from('lca_records')
      .select(
        'employer_name, employer_name_normalized, company_id, case_status, fiscal_year, wage_level, job_title, soc_code, worksite_state_abbr'
      )
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`load lca_records: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data as Array<{
      employer_name: string
      employer_name_normalized: string | null
      company_id: string | null
      case_status: string | null
      fiscal_year: number | null
      wage_level: string | null
      job_title: string | null
      soc_code: string | null
      worksite_state_abbr: string | null
    }>) {
      const key = row.employer_name_normalized
      if (!key) continue
      const bucket = byEmployer.get(key) ?? {
        display: row.employer_name,
        companyId: row.company_id,
        rows: [],
      }
      if (row.company_id && !bucket.companyId) bucket.companyId = row.company_id
      bucket.rows.push({
        status: row.case_status,
        year: row.fiscal_year,
        wageLevel: row.wage_level,
        jobTitle: row.job_title,
        soc: row.soc_code,
        state: row.worksite_state_abbr,
      })
      byEmployer.set(key, bucket)
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  // Compute each employer's aggregated record.
  const inserts: Array<
    Omit<EmployerLCAStats, 'id' | 'last_updated'>
  > = []

  for (const [key, bucket] of byEmployer) {
    const totals = { certified: 0, denied: 0, withdrawn: 0, total: 0 }
    const byYear = new Map<number, YearStat>()
    const byLevel = new Map<string, WageLevelStat>()
    const byTitle = new Map<string, { count: number; cert: number; soc: string | null }>()
    const byState = new Map<string, number>()

    for (const r of bucket.rows) {
      totals.total++
      const status = (r.status ?? '').toLowerCase()
      const isCertified = status.startsWith('certified')
      const isDenied = status === 'denied'
      const isWithdrawn = status.includes('withdrawn') && !isCertified
      if (isCertified) totals.certified++
      if (isDenied) totals.denied++
      if (isWithdrawn) totals.withdrawn++

      if (r.year != null) {
        const y = byYear.get(r.year) ?? {
          total: 0,
          certified: 0,
          denied: 0,
          rate: 0,
        }
        y.total++
        if (isCertified) y.certified++
        if (isDenied) y.denied++
        byYear.set(r.year, y)
      }

      if (r.wageLevel) {
        const level = r.wageLevel.replace(/[^IVX]/gi, '').toUpperCase()
        if (level) {
          const w = byLevel.get(level) ?? { total: 0, certified: 0, rate: 0 }
          w.total++
          if (isCertified) w.certified++
          byLevel.set(level, w)
        }
      }

      if (r.jobTitle) {
        const key = r.jobTitle.slice(0, 120)
        const t = byTitle.get(key) ?? { count: 0, cert: 0, soc: r.soc }
        t.count++
        if (isCertified) t.cert++
        byTitle.set(key, t)
      }

      if (r.state) byState.set(r.state, (byState.get(r.state) ?? 0) + 1)
    }

    // Normalize rates.
    for (const v of byYear.values()) {
      v.rate = v.total > 0 ? round(v.certified / v.total) : 0
    }
    for (const v of byLevel.values()) {
      v.rate = v.total > 0 ? round(v.certified / v.total) : 0
    }

    const decided = totals.certified + totals.denied
    const certRate = decided > 0 ? round(totals.certified / decided) : null

    const name = bucket.display
    const isStaffing = STAFFING_PATTERNS.test(name)
    const isConsulting = CONSULTING_PATTERNS.test(name)

    const recentYears = Array.from(byYear.keys()).sort((a, b) => b - a)
    const latestYear = recentYears[0]
    const threeYrRates = recentYears
      .slice(0, 3)
      .map((y) => byYear.get(y)!.rate)
    const avg3 =
      threeYrRates.length > 0
        ? threeYrRates.reduce((s, x) => s + x, 0) / threeYrRates.length
        : 0
    const lastYrRate = latestYear ? byYear.get(latestYear)!.rate : 0

    let trend: 'improving' | 'declining' | 'stable' = 'stable'
    if (threeYrRates.length >= 2) {
      if (lastYrRate > avg3 + 0.05) trend = 'improving'
      else if (lastYrRate < avg3 - 0.05) trend = 'declining'
    }

    const topJobTitles: TopJobTitle[] = Array.from(byTitle.entries())
      .map(([title, v]) => ({
        title,
        soc_code: v.soc,
        count: v.count,
        cert_rate: v.count > 0 ? round(v.cert / v.count) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const topStates: TopState[] = Array.from(byState.entries())
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    const statsByYear: Record<string, YearStat> = {}
    for (const [year, v] of byYear) statsByYear[String(year)] = v
    const statsByWageLevel: Record<string, WageLevelStat> = {}
    for (const [lvl, v] of byLevel) statsByWageLevel[lvl] = v

    inserts.push({
      employer_name_normalized: key,
      company_id: bucket.companyId,
      display_name: name,
      total_applications: totals.total,
      total_certified: totals.certified,
      total_denied: totals.denied,
      total_withdrawn: totals.withdrawn,
      certification_rate: certRate,
      stats_by_year: statsByYear,
      stats_by_wage_level: statsByWageLevel,
      top_job_titles: topJobTitles,
      top_states: topStates,
      is_staffing_firm: isStaffing,
      is_consulting_firm: isConsulting,
      has_high_denial_rate: decided >= 5 && certRate !== null && certRate < 0.8,
      is_first_time_filer: totals.total < 5,
      approval_trend: trend,
    })
  }

  // Upsert in chunks.
  const CHUNK = 500
  for (let i = 0; i < inserts.length; i += CHUNK) {
    const slice = inserts.slice(i, i + CHUNK)
    const { error } = await supabase
      .from('employer_lca_stats')
      .upsert(slice as never, {
        onConflict: 'employer_name_normalized',
      })
    if (error) throw new Error(`upsert employer stats: ${error.message}`)
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

// ---------------------------------------------------------------------------
// Matching LCA stats to companies
// ---------------------------------------------------------------------------

export async function matchLCAToCompanies(): Promise<void> {
  const supabase = createAdminClient()

  const { data: stats, error: statsErr } = await supabase
    .from('employer_lca_stats')
    .select(
      'id, employer_name_normalized, company_id, display_name, total_certified, total_applications, total_denied, stats_by_year'
    )
  if (statsErr) throw new Error(statsErr.message)
  if (!stats || stats.length === 0) return

  const { data: companies, error: compErr } = await supabase
    .from('companies')
    .select('id, name, domain')
  if (compErr) throw new Error(compErr.message)
  const companyList = (companies ?? []) as Array<
    Pick<Company, 'id' | 'name' | 'domain'>
  >

  const index = buildCompanyIndex(companyList)

  // Pass 1 — bind every stats row to a company_id.
  const statsUpdates: Array<{ id: string; company_id: string }> = []
  const companyUpdates = new Map<
    string,
    {
      h1b_sponsor_count_1yr: number
      h1b_sponsor_count_3yr: number
      sponsors_h1b: boolean
      sponsorship_confidence: number
    }
  >()

  for (const s of stats as Array<{
    id: string
    employer_name_normalized: string
    company_id: string | null
    display_name: string | null
    total_certified: number
    total_applications: number
    total_denied: number
    stats_by_year: Record<string, YearStat> | null
  }>) {
    const companyId =
      s.company_id ??
      index.byNormalized.get(s.employer_name_normalized) ??
      null
    if (!companyId) continue
    if (companyId !== s.company_id) {
      statsUpdates.push({ id: s.id, company_id: companyId })
    }

    // Aggregate 1y / 3y cert counts for companies.*
    const byYear = s.stats_by_year ?? {}
    const years = Object.keys(byYear)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a)
    const lastYear = years[0]
    const threeYears = years.slice(0, 3)
    const cert1y = lastYear ? (byYear[String(lastYear)]?.certified ?? 0) : 0
    const cert3y = threeYears.reduce(
      (sum, y) => sum + (byYear[String(y)]?.certified ?? 0),
      0
    )

    const decided = s.total_certified + s.total_denied
    const approvalRate = decided > 0 ? s.total_certified / decided : 0
    const confidence = calcSponsorshipConfidence(cert1y, approvalRate)

    companyUpdates.set(companyId, {
      h1b_sponsor_count_1yr: cert1y,
      h1b_sponsor_count_3yr: cert3y,
      sponsors_h1b: cert1y > 0 || cert3y > 0,
      sponsorship_confidence: confidence,
    })
  }

  for (const update of statsUpdates) {
    await (supabase.from('employer_lca_stats') as any)
      .update({ company_id: update.company_id })
      .eq('id', update.id)
  }

  for (const [companyId, patch] of companyUpdates) {
    await (supabase.from('companies') as any).update(patch).eq('id', companyId)
  }

  // Also backfill company_id on lca_records rows that are still unlinked but
  // whose normalised employer now maps to a company (e.g. a company was
  // created after the initial insert).
  const unlinkedMap = new Map<string, string>()
  for (const s of stats as Array<{
    employer_name_normalized: string
    company_id: string | null
  }>) {
    if (s.company_id) unlinkedMap.set(s.employer_name_normalized, s.company_id)
  }

  for (const [norm, companyId] of unlinkedMap) {
    await (supabase.from('lca_records') as any)
      .update({ company_id: companyId })
      .eq('employer_name_normalized', norm)
      .is('company_id', null)
  }
}

function calcSponsorshipConfidence(
  cert1y: number,
  approvalRate: number
): number {
  let score = 0
  if (cert1y > 0) score += 70
  if (approvalRate > 0.85) score += 10
  if (cert1y > 10) score += 10
  if (cert1y > 50) score += 10
  return Math.min(100, score)
}

/**
 * Aggregate certified/denied counts per 6-digit SOC code across all
 * `lca_records`, then upsert into `soc_base_rates`. Runs at the end of every
 * LCA import so priors stay fresh with each quarterly DOL drop.
 *
 * Withdrawn cases are excluded — they don't reflect a DOL decision, only
 * employer action.
 */
export async function rebuildSOCBaseRates(): Promise<void> {
  const supabase = createAdminClient()

  type SocBucket = {
    title: string | null
    certified: number
    denied: number
  }
  const bySoc = new Map<string, SocBucket>()

  let offset = 0
  const pageSize = 10_000
  while (true) {
    const { data, error } = await supabase
      .from('lca_records')
      .select('soc_code, soc_title, case_status')
      .not('soc_code', 'is', null)
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(`load lca_records for SOC: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data as Array<{
      soc_code: string | null
      soc_title: string | null
      case_status: string | null
    }>) {
      if (!row.soc_code) continue
      const socNorm = row.soc_code.trim().replace(/\.\d+$/, '')
      if (!/^\d{2}-\d{4}$/.test(socNorm)) continue
      const status = (row.case_status ?? '').toLowerCase()
      const bucket = bySoc.get(socNorm) ?? {
        title: row.soc_title,
        certified: 0,
        denied: 0,
      }
      if (!bucket.title && row.soc_title) bucket.title = row.soc_title
      if (status.includes('certified') && !status.includes('withdrawn')) {
        bucket.certified += 1
      } else if (status.includes('denied')) {
        bucket.denied += 1
      }
      bySoc.set(socNorm, bucket)
    }

    if (data.length < pageSize) break
    offset += pageSize
  }

  if (bySoc.size === 0) return

  const MIN_SAMPLES = 25
  const rows: Array<{
    soc_code: string
    soc_title: string | null
    total_applications: number
    total_certified: number
    total_denied: number
    approval_rate: number | null
    sample_size: number
    last_updated: string
  }> = []
  const now = new Date().toISOString()

  for (const [soc, bucket] of bySoc) {
    const decided = bucket.certified + bucket.denied
    if (decided < MIN_SAMPLES) continue
    rows.push({
      soc_code: soc,
      soc_title: bucket.title,
      total_applications: decided,
      total_certified: bucket.certified,
      total_denied: bucket.denied,
      approval_rate: bucket.certified / decided,
      sample_size: decided,
      last_updated: now,
    })
  }

  if (rows.length === 0) return

  // Supabase `upsert` with onConflict so re-running an import just refreshes
  // the numbers in place rather than creating duplicates.
  const BATCH = 500
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await (supabase.from('soc_base_rates') as any).upsert(
      chunk,
      { onConflict: 'soc_code' }
    )
    if (error) throw new Error(`upsert soc_base_rates: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// US state abbr dictionary (for worksite state normalisation)
// ---------------------------------------------------------------------------

const US_STATE_NAME_TO_ABBR: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
  MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI',
  WYOMING: 'WY', 'PUERTO RICO': 'PR',
}
