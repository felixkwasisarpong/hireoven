import { parse } from 'csv-parse/sync'
import { createClient } from '@/lib/supabase/server'
import type { Company, CompanyUpdate, H1BRecordInsert } from '@/types'

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
}

export async function importH1BDataFromBuffer(content: string): Promise<H1BImportResult> {
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[]

  const supabase = await createClient()
  const { data: companiesData } = await supabase.from('companies').select('id, name')
  if (!companiesData) throw new Error('Could not load companies from database')
  const companies = companiesData as Array<Pick<Company, 'id' | 'name'>>

  // Aggregate all rows by employer name first
  const aggregated = new Map<string, { approvals: number; denials: number }>()
  for (const row of rows) {
    const employer = (row['Employer'] ?? row['EMPLOYER_NAME'] ?? '').trim()
    if (!employer) continue
    const approvals = (parseInt(row['Initial Approvals'] ?? row['INITIAL_APPROVALS'] ?? '0', 10) || 0)
      + (parseInt(row['Continuing Approvals'] ?? row['CONTINUING_APPROVALS'] ?? '0', 10) || 0)
    const denials = parseInt(row['Initial Denials'] ?? row['INITIAL_DENIALS'] ?? '0', 10) || 0
    const existing = aggregated.get(employer) ?? { approvals: 0, denials: 0 }
    aggregated.set(employer, { approvals: existing.approvals + approvals, denials: existing.denials + denials })
  }

  let matched = 0
  let skipped = 0
  let scoresUpdated = 0
  const unmatchedEmployers: string[] = []
  const year = new Date().getFullYear()

  for (const [employerName, stats] of Array.from(aggregated.entries())) {
    const company = companies.find(c => fuzzyMatch(employerName, c.name))
    const total = stats.approvals + stats.denials
    const approvalRate = total > 0 ? stats.approvals / total : 0
    const confidence = calcConfidence(stats.approvals, approvalRate)
    const h1bRecord: H1BRecordInsert = {
      company_id: company?.id ?? null,
      employer_name: employerName,
      year,
      total_petitions: total,
      approved: stats.approvals,
      denied: stats.denials,
      initial_approvals: stats.approvals,
      continuing_approvals: 0,
      naics_code: null,
      raw_data: {
        approvals: stats.approvals,
        denials: stats.denials,
      },
    }

    const { data: existingRecord } = await (supabase
      .from('h1b_records')
      .select('id')
      .eq('employer_name', employerName)
      .eq('year', year)
      .maybeSingle() as any)

    if (existingRecord?.id) {
      await (supabase.from('h1b_records') as any).update(h1bRecord).eq('id', existingRecord.id)
    } else {
      await (supabase.from('h1b_records') as any).insert(h1bRecord)
    }

    if (!company) {
      skipped++
      unmatchedEmployers.push(employerName)
      continue
    }

    const update: CompanyUpdate = {
      h1b_sponsor_count_1yr: stats.approvals,
      sponsors_h1b: stats.approvals > 0,
      sponsorship_confidence: confidence,
    }
    await (supabase.from('companies') as any).update(update).eq('id', company.id)
    matched++
    scoresUpdated++
  }

  return {
    processed: aggregated.size,
    matched,
    skipped,
    scoresUpdated,
    unmatchedEmployers,
  }
}
