/**
 * Relink unmatched USCIS employer names to existing companies using safe,
 * deterministic normalization (no fuzzy distance matching).
 *
 * This fixes cases like:
 * - "VISA U S A INC"        -> "Visa U.S.A. Inc."
 * - "AMAZON COM SERVICES"   -> "Amazon.com Services LLC"
 * - "CHILDRENS ..." vs "CHILDREN'S ..."
 *
 * Matching strategy (in order):
 * 1. raw (case-insensitive exact company.name)
 * 2. normalized key exact (strip punctuation, legal suffixes, normalize '&')
 * 3. tight key exact (normalized key with spaces removed)
 *
 * Only unique matches are linked; ambiguous matches are skipped.
 *
 * Usage:
 *   npx tsx scripts/relink-h1b-unmatched-employers.ts
 *   npx tsx scripts/relink-h1b-unmatched-employers.ts --execute
 *   npx tsx scripts/relink-h1b-unmatched-employers.ts --execute --limit=200
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'

loadEnvConfig(process.cwd())

function flag(name: string): string | undefined {
  const prefix = `--${name}=`
  const direct = process.argv.find((a) => a.startsWith(prefix))
  if (direct) return direct.slice(prefix.length)
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1) return process.argv[idx + 1]
  return undefined
}

const execute = process.argv.includes('--execute')
const verbose = process.argv.includes('--verbose')
const limit = Number(flag('limit')) || undefined
const reportPath = flag('report') || 'scripts/output/h1b-relink-report.json'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env'
  )
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type CompanyRow = {
  id: string
  name: string
}

type EmployerAgg = {
  employerName: string
  rows: number
  approved: number
  denied: number
}

type Candidate = {
  employerName: string
  companyId: string
  companyName: string
  mode: 'raw' | 'norm' | 'tight'
  rows: number
  approved: number
  denied: number
}

const LEGAL_SUFFIXES = new Set([
  'INC',
  'INCORPORATED',
  'LLC',
  'L.L.C',
  'LTD',
  'LIMITED',
  'CORP',
  'CORPORATION',
  'CO',
  'COMPANY',
  'PLC',
  'LLP',
  'LP',
  'HOLDINGS',
  'HOLDING',
])

function normalizeEmployerName(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !LEGAL_SUFFIXES.has(token))
    .join(' ')
    .trim()
}

function tightKey(name: string): string {
  return normalizeEmployerName(name).replace(/\s+/g, '')
}

function upperKey(name: string): string {
  return name.toUpperCase().trim()
}

function writeReport(payload: unknown): void {
  const abs = path.isAbsolute(reportPath)
    ? reportPath
    : path.join(process.cwd(), reportPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, JSON.stringify(payload, null, 2))
  console.log(`[h1b-relink] report: ${abs}`)
}

async function loadCompanies(): Promise<CompanyRow[]> {
  const rows: CompanyRow[] = []
  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from('companies')
      .select('id, name')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`load companies: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...(data as CompanyRow[]))
    if (data.length < pageSize) break
    from += pageSize
  }
  return rows
}

async function loadUnlinkedEmployerAggs(): Promise<Map<string, EmployerAgg>> {
  const byEmployer = new Map<string, EmployerAgg>()
  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from('h1b_records')
      .select('employer_name, approved, denied')
      .is('company_id', null)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`load h1b_records: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data as Array<{
      employer_name: string
      approved: number | null
      denied: number | null
    }>) {
      const employerName = row.employer_name
      const current = byEmployer.get(employerName) ?? {
        employerName,
        rows: 0,
        approved: 0,
        denied: 0,
      }
      current.rows += 1
      current.approved += Number(row.approved) || 0
      current.denied += Number(row.denied) || 0
      byEmployer.set(employerName, current)
    }

    if (data.length < pageSize) break
    from += pageSize
    if (from > 0 && from % 50000 === 0) {
      console.log(`[h1b-relink] scanned ${from.toLocaleString()} h1b rows...`)
    }
  }
  return byEmployer
}

function makeIndex(
  companies: CompanyRow[],
  keyFn: (name: string) => string
): Map<string, CompanyRow[]> {
  const out = new Map<string, CompanyRow[]>()
  for (const company of companies) {
    const key = keyFn(company.name)
    if (!key) continue
    out.set(key, [...(out.get(key) ?? []), company])
  }
  return out
}

function chooseCandidate(
  employerName: string,
  agg: EmployerAgg,
  rawIndex: Map<string, CompanyRow[]>,
  normIndex: Map<string, CompanyRow[]>,
  tightIndex: Map<string, CompanyRow[]>
): { match: Candidate | null; ambiguous: boolean } {
  const rawCandidates = rawIndex.get(upperKey(employerName)) ?? []
  if (rawCandidates.length === 1) {
    const company = rawCandidates[0]!
    return {
      match: {
        employerName,
        companyId: company.id,
        companyName: company.name,
        mode: 'raw',
        rows: agg.rows,
        approved: agg.approved,
        denied: agg.denied,
      },
      ambiguous: false,
    }
  }
  if (rawCandidates.length > 1) return { match: null, ambiguous: true }

  const normCandidates = normIndex.get(normalizeEmployerName(employerName)) ?? []
  if (normCandidates.length === 1) {
    const company = normCandidates[0]!
    return {
      match: {
        employerName,
        companyId: company.id,
        companyName: company.name,
        mode: 'norm',
        rows: agg.rows,
        approved: agg.approved,
        denied: agg.denied,
      },
      ambiguous: false,
    }
  }
  if (normCandidates.length > 1) return { match: null, ambiguous: true }

  const tightCandidates = tightIndex.get(tightKey(employerName)) ?? []
  if (tightCandidates.length === 1) {
    const company = tightCandidates[0]!
    return {
      match: {
        employerName,
        companyId: company.id,
        companyName: company.name,
        mode: 'tight',
        rows: agg.rows,
        approved: agg.approved,
        denied: agg.denied,
      },
      ambiguous: false,
    }
  }
  if (tightCandidates.length > 1) return { match: null, ambiguous: true }

  return { match: null, ambiguous: false }
}

async function main() {
  console.log(
    `\n[h1b-relink] mode=${execute ? 'EXECUTE' : 'dry-run'}${
      limit ? ` limit=${limit}` : ''
    }\n`
  )

  const [companies, employerAggs] = await Promise.all([
    loadCompanies(),
    loadUnlinkedEmployerAggs(),
  ])

  const rawIndex = makeIndex(companies, upperKey)
  const normIndex = makeIndex(companies, normalizeEmployerName)
  const tightIndex = makeIndex(companies, tightKey)

  const matches: Candidate[] = []
  const ambiguous: EmployerAgg[] = []
  const noMatch: EmployerAgg[] = []

  for (const agg of employerAggs.values()) {
    const decision = chooseCandidate(
      agg.employerName,
      agg,
      rawIndex,
      normIndex,
      tightIndex
    )
    if (decision.match) {
      matches.push(decision.match)
      continue
    }
    if (decision.ambiguous) ambiguous.push(agg)
    else noMatch.push(agg)
  }

  matches.sort((a, b) => b.approved - a.approved)
  const work = limit ? matches.slice(0, limit) : matches

  const modeCounts = {
    raw: work.filter((m) => m.mode === 'raw').length,
    norm: work.filter((m) => m.mode === 'norm').length,
    tight: work.filter((m) => m.mode === 'tight').length,
  }
  const coveredRows = work.reduce((sum, m) => sum + m.rows, 0)
  const coveredApprovals = work.reduce((sum, m) => sum + m.approved, 0)

  console.log(
    `[h1b-relink] unmatched employer aliases: ${employerAggs.size.toLocaleString()}`
  )
  console.log(
    `[h1b-relink] unique candidates: ${matches.length.toLocaleString()} (raw=${modeCounts.raw} norm=${modeCounts.norm} tight=${modeCounts.tight})`
  )
  console.log(
    `[h1b-relink] coverage in this run: rows=${coveredRows.toLocaleString()} approvals=${coveredApprovals.toLocaleString()}`
  )
  console.log(
    `[h1b-relink] skipped: ambiguous=${ambiguous.length.toLocaleString()} no-match=${noMatch.length.toLocaleString()}`
  )

  for (const m of work.slice(0, 20)) {
    console.log(
      `  ${m.employerName.slice(0, 42).padEnd(42)} -> ${m.companyName.slice(
        0,
        42
      ).padEnd(42)} [${m.mode}] approvals=${m.approved}`
    )
  }

  writeReport({
    generated_at: new Date().toISOString(),
    mode: execute ? 'execute' : 'dry-run',
    companies: companies.length,
    unmatched_aliases: employerAggs.size,
    matched_aliases: matches.length,
    ambiguous_aliases: ambiguous.length,
    no_match_aliases: noMatch.length,
    coverage: {
      rows: coveredRows,
      approvals: coveredApprovals,
    },
    match_modes: modeCounts,
    top_matches: work.slice(0, 300),
    top_ambiguous: ambiguous
      .sort((a, b) => b.approved - a.approved)
      .slice(0, 100),
    top_no_match: noMatch.sort((a, b) => b.approved - a.approved).slice(0, 100),
  })

  if (!execute) {
    console.log('\n[h1b-relink] dry-run complete. Re-run with --execute.\n')
    return
  }

  let updatedAliases = 0
  for (const match of work) {
    const { error } = await admin
      .from('h1b_records')
      .update({ company_id: match.companyId })
      .is('company_id', null)
      .eq('employer_name', match.employerName)
    if (error) {
      console.error(
        `[h1b-relink] failed ${match.employerName} -> ${match.companyName}: ${error.message}`
      )
      continue
    }
    updatedAliases += 1
    if (verbose) {
      console.log(
        `[h1b-relink] linked ${match.employerName} -> ${match.companyName} (${match.rows} rows)`
      )
    } else if (updatedAliases % 200 === 0 || updatedAliases === work.length) {
      console.log(`[h1b-relink] progress ${updatedAliases}/${work.length}`)
    }
  }

  console.log(
    `\n[h1b-relink] done. employer aliases linked=${updatedAliases}/${work.length}\n`
  )
}

main().catch((err) => {
  console.error('\nh1b relink failed:', err)
  process.exit(1)
})
