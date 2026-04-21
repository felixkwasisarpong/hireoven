/**
 * Recompute denormalized company sponsorship fields from imported USCIS + LCA data.
 *
 * Why this exists:
 * - `companies.sponsorship_confidence` is a denormalized snapshot.
 * - Reconcile/dedupe flows can relink `h1b_records` / `employer_lca_stats`
 *   without recalculating the company-level snapshot.
 * - This script backfills those fields from already-linked raw data.
 *
 * Usage:
 *   npx tsx scripts/recompute-company-h1b-scores.ts            # dry run
 *   npx tsx scripts/recompute-company-h1b-scores.ts --execute  # write updates
 *   npx tsx scripts/recompute-company-h1b-scores.ts --execute --limit=250
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

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
  sponsorship_confidence: number | null
  sponsors_h1b: boolean | null
  h1b_sponsor_count_1yr: number | null
  h1b_sponsor_count_3yr: number | null
}

type CompanyPatch = {
  sponsorship_confidence: number
  sponsors_h1b: boolean
  h1b_sponsor_count_1yr: number
  h1b_sponsor_count_3yr: number
}

type UscisSnapshot = {
  latestYear: number
  approvals: number
  denials: number
  total: number
  approvalRate: number
}

type LcaSnapshot = {
  latestYear: number | null
  cert1y: number
  cert3y: number
  totalCertified: number
  totalDenied: number
  approvalRate: number
}

type PlannedUpdate = {
  company: CompanyRow
  patch: CompanyPatch
  source: 'uscis' | 'lca' | 'none'
  detail: string
}

function calcUSCISConfidence(total1yr: number, approvalRate: number): number {
  let score = 0
  if (total1yr > 0) score += 50 + 20
  if (approvalRate > 0.8) score += 10
  if (total1yr > 10) score += 10
  if (total1yr > 50) score += 10
  return Math.min(100, score)
}

function calcLCAConfidence(cert1y: number, approvalRate: number): number {
  let score = 0
  if (cert1y > 0) score += 70
  if (approvalRate > 0.85) score += 10
  if (cert1y > 10) score += 10
  if (cert1y > 50) score += 10
  return Math.min(100, score)
}

function coerceNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function patchEquals(company: CompanyRow, patch: CompanyPatch): boolean {
  return (
    (company.sponsorship_confidence ?? 0) === patch.sponsorship_confidence &&
    Boolean(company.sponsors_h1b) === patch.sponsors_h1b &&
    (company.h1b_sponsor_count_1yr ?? 0) === patch.h1b_sponsor_count_1yr &&
    (company.h1b_sponsor_count_3yr ?? 0) === patch.h1b_sponsor_count_3yr
  )
}

async function fetchCompanies(): Promise<CompanyRow[]> {
  const rows: CompanyRow[] = []
  const pageSize = 1000
  let from = 0
  while (true) {
    const { data, error } = await admin
      .from('companies')
      .select(
        'id, name, sponsorship_confidence, sponsors_h1b, h1b_sponsor_count_1yr, h1b_sponsor_count_3yr'
      )
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`load companies: ${error.message}`)
    if (!data || data.length === 0) break
    rows.push(...(data as CompanyRow[]))
    if (data.length < pageSize) break
    from += pageSize
  }
  return rows
}

async function buildUSCISSnapshots(): Promise<Map<string, UscisSnapshot>> {
  const byCompany = new Map<string, Map<number, { approvals: number; denials: number }>>()

  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from('h1b_records')
      .select('company_id, year, approved, denied')
      .not('company_id', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`load h1b_records: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data as Array<{
      company_id: string | null
      year: number | null
      approved: number | null
      denied: number | null
    }>) {
      if (!row.company_id) continue
      const year = Number(row.year)
      if (!Number.isFinite(year)) continue
      const byYear = byCompany.get(row.company_id) ?? new Map()
      const current = byYear.get(year) ?? { approvals: 0, denials: 0 }
      current.approvals += coerceNumber(row.approved)
      current.denials += coerceNumber(row.denied)
      byYear.set(year, current)
      byCompany.set(row.company_id, byYear)
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  const snapshots = new Map<string, UscisSnapshot>()
  for (const [companyId, byYear] of byCompany) {
    const latestYear = Math.max(...Array.from(byYear.keys()))
    const latest = byYear.get(latestYear) ?? { approvals: 0, denials: 0 }
    const total = latest.approvals + latest.denials
    snapshots.set(companyId, {
      latestYear,
      approvals: latest.approvals,
      denials: latest.denials,
      total,
      approvalRate: total > 0 ? latest.approvals / total : 0,
    })
  }

  return snapshots
}

async function buildLCASnapshots(): Promise<Map<string, LcaSnapshot>> {
  const aggregates = new Map<
    string,
    {
      totalCertified: number
      totalDenied: number
      certByYear: Map<number, number>
    }
  >()

  const pageSize = 1000
  let from = 0
  for (;;) {
    const { data, error } = await admin
      .from('employer_lca_stats')
      .select('company_id, total_certified, total_denied, stats_by_year')
      .not('company_id', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`load employer_lca_stats: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data as Array<{
      company_id: string | null
      total_certified: number | null
      total_denied: number | null
      stats_by_year: Record<string, { certified?: number }> | null
    }>) {
      if (!row.company_id) continue
      const current = aggregates.get(row.company_id) ?? {
        totalCertified: 0,
        totalDenied: 0,
        certByYear: new Map<number, number>(),
      }
      current.totalCertified += coerceNumber(row.total_certified)
      current.totalDenied += coerceNumber(row.total_denied)

      const byYear = row.stats_by_year
      if (byYear && typeof byYear === 'object') {
        for (const [yearKey, stats] of Object.entries(byYear)) {
          const year = Number(yearKey)
          if (!Number.isFinite(year)) continue
          const certified = coerceNumber(stats?.certified)
          current.certByYear.set(year, (current.certByYear.get(year) ?? 0) + certified)
        }
      }

      aggregates.set(row.company_id, current)
    }

    if (data.length < pageSize) break
    from += pageSize
  }

  const snapshots = new Map<string, LcaSnapshot>()
  for (const [companyId, agg] of aggregates) {
    const years = Array.from(agg.certByYear.keys()).sort((a, b) => b - a)
    const latestYear = years.length > 0 ? years[0] : null
    const cert1y = latestYear ? agg.certByYear.get(latestYear) ?? 0 : 0
    const cert3y = years
      .slice(0, 3)
      .reduce((sum, year) => sum + (agg.certByYear.get(year) ?? 0), 0)
    const decided = agg.totalCertified + agg.totalDenied
    snapshots.set(companyId, {
      latestYear,
      cert1y,
      cert3y,
      totalCertified: agg.totalCertified,
      totalDenied: agg.totalDenied,
      approvalRate: decided > 0 ? agg.totalCertified / decided : 0,
    })
  }

  return snapshots
}

function choosePatch(
  uscis: UscisSnapshot | undefined,
  lca: LcaSnapshot | undefined
): { patch: CompanyPatch; source: 'uscis' | 'lca' | 'none'; detail: string } {
  const lca3y = lca?.cert3y ?? 0

  if (uscis && uscis.total > 0) {
    return {
      patch: {
        h1b_sponsor_count_1yr: uscis.approvals,
        h1b_sponsor_count_3yr: lca3y,
        sponsors_h1b: uscis.approvals > 0 || lca3y > 0,
        sponsorship_confidence: calcUSCISConfidence(
          uscis.approvals,
          uscis.approvalRate
        ),
      },
      source: 'uscis',
      detail: `USCIS latest FY${uscis.latestYear}: approvals=${uscis.approvals}, denials=${uscis.denials}; LCA-3yr=${lca3y}`,
    }
  }

  if (lca) {
    const decided = lca.totalCertified + lca.totalDenied
    if (decided > 0 || lca.cert1y > 0 || lca.cert3y > 0) {
      return {
        patch: {
          h1b_sponsor_count_1yr: lca.cert1y,
          h1b_sponsor_count_3yr: lca.cert3y,
          sponsors_h1b: lca.cert1y > 0 || lca.cert3y > 0,
          sponsorship_confidence: calcLCAConfidence(lca.cert1y, lca.approvalRate),
        },
        source: 'lca',
        detail: `LCA latest FY${lca.latestYear ?? 'n/a'}: cert1y=${lca.cert1y}, cert3y=${lca.cert3y}`,
      }
    }
  }

  return {
    patch: {
      h1b_sponsor_count_1yr: 0,
      h1b_sponsor_count_3yr: 0,
      sponsors_h1b: false,
      sponsorship_confidence: 0,
    },
    source: 'none',
    detail: 'No linked USCIS/LCA signal',
  }
}

async function main() {
  console.log(
    `\n[h1b-recompute] mode=${execute ? 'EXECUTE' : 'dry-run'}${
      limit ? ` limit=${limit}` : ''
    }\n`
  )

  const [companies, uscisByCompany, lcaByCompany] = await Promise.all([
    fetchCompanies(),
    buildUSCISSnapshots(),
    buildLCASnapshots(),
  ])

  console.log(`[h1b-recompute] companies: ${companies.length.toLocaleString()}`)
  console.log(
    `[h1b-recompute] signals: uscis=${uscisByCompany.size.toLocaleString()} lca=${lcaByCompany.size.toLocaleString()}`
  )

  let unchanged = 0
  const updates: PlannedUpdate[] = []
  for (const company of companies) {
    const selected = choosePatch(
      uscisByCompany.get(company.id),
      lcaByCompany.get(company.id)
    )
    if (patchEquals(company, selected.patch)) {
      unchanged++
      continue
    }
    updates.push({
      company,
      patch: selected.patch,
      source: selected.source,
      detail: selected.detail,
    })
  }

  updates.sort((a, b) => b.patch.sponsorship_confidence - a.patch.sponsorship_confidence)
  const work = limit ? updates.slice(0, limit) : updates

  const bySource = {
    uscis: work.filter((u) => u.source === 'uscis').length,
    lca: work.filter((u) => u.source === 'lca').length,
    none: work.filter((u) => u.source === 'none').length,
  }
  const nonZeroAfter = work.filter((u) => u.patch.sponsorship_confidence > 0).length

  console.log(`[h1b-recompute] unchanged: ${unchanged.toLocaleString()}`)
  console.log(`[h1b-recompute] updates queued: ${work.length.toLocaleString()}`)
  console.log(
    `[h1b-recompute] update sources: uscis=${bySource.uscis} lca=${bySource.lca} none=${bySource.none}`
  )
  console.log(`[h1b-recompute] updates with confidence > 0: ${nonZeroAfter}`)

  if (work.length === 0) {
    console.log('[h1b-recompute] nothing to do.')
    return
  }

  for (const row of work.slice(0, 15)) {
    console.log(
      `  ${row.company.name.slice(0, 44).padEnd(44)} ${String(
        row.company.sponsorship_confidence ?? 0
      ).padStart(3)} -> ${String(row.patch.sponsorship_confidence).padStart(3)}  [${row.source}]`
    )
    if (verbose) {
      console.log(`    ${row.detail}`)
    }
  }

  if (!execute) {
    console.log('\n[h1b-recompute] dry-run complete. Re-run with --execute.\n')
    return
  }

  let updated = 0
  for (const row of work) {
    const { error } = await (admin.from('companies') as any)
      .update(row.patch)
      .eq('id', row.company.id)
    if (error) {
      console.error(
        `[h1b-recompute] update failed for ${row.company.id} (${row.company.name}): ${error.message}`
      )
      continue
    }
    updated += 1
    if (updated % 100 === 0 || updated === work.length) {
      console.log(`[h1b-recompute] updated ${updated}/${work.length}`)
    }
  }

  console.log(`\n[h1b-recompute] done. updated=${updated} requested=${work.length}\n`)
}

main().catch((err) => {
  console.error('\nh1b recompute failed:', err)
  process.exit(1)
})
