import { NextRequest, NextResponse } from "next/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { coercedSponsorshipPercent } from "@/lib/jobs/sponsorship-employer-signal"

export const runtime = "nodejs"

export type SponsorshipVerdict = "active_sponsor" | "unverified" | "claims_only" | "no_data"

export type SponsorshipTruthData = {
  score: number
  verdict: SponsorshipVerdict
  totalFilings: number
  certRate: number | null
  denialRate: number | null
  avgSalary: number | null
  filingsByYear: Array<{ year: number; total: number }>
  visaTypes: Array<{ type: string; count: number }>
  employerClaim: boolean | null
  approvalTrend: string | null
  isStaffingFirm: boolean
  hasHighDenialRate: boolean
  dataSource: string
  lastUpdated: string | null
}

function computeVerdict(args: {
  sponsorshipConfidence: number
  sponsorsH1b: boolean | null
  totalFilings: number
}): SponsorshipVerdict {
  const { sponsorshipConfidence, sponsorsH1b, totalFilings } = args
  if (sponsorshipConfidence >= 70 && totalFilings > 0) return "active_sponsor"
  if (sponsorsH1b && totalFilings === 0) return "claims_only"
  if (sponsorshipConfidence >= 30 || totalFilings > 0) return "unverified"
  return "no_data"
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const pool = getPostgresPool()

  // Company row + aggregated LCA stats in parallel
  const [companyResult, statsResult] = await Promise.all([
    pool.query<{
      name: string
      sponsors_h1b: boolean | null
      sponsorship_confidence: number | null
      h1b_sponsor_count_1yr: number | null
      h1b_sponsor_count_3yr: number | null
      updated_at: string | null
    }>(
      `SELECT name, sponsors_h1b, sponsorship_confidence,
              h1b_sponsor_count_1yr, h1b_sponsor_count_3yr, updated_at
       FROM companies
       WHERE id = $1
       LIMIT 1`,
      [id]
    ),
    pool.query<{
      total_applications: string | null
      total_certified: string | null
      total_denied: string | null
      certification_rate: number | null
      approval_trend: string | null
      has_high_denial_rate: boolean | null
      is_staffing_firm: boolean | null
    }>(
      `SELECT total_applications, total_certified, total_denied,
              certification_rate, approval_trend,
              has_high_denial_rate, is_staffing_firm
       FROM employer_lca_stats
       WHERE company_id = $1
       LIMIT 1`,
      [id]
    ),
  ])

  const company = companyResult.rows[0]
  if (!company) {
    return NextResponse.json({ error: "Employer not found" }, { status: 404 })
  }

  const stats = statsResult.rows[0] ?? null

  // Year-by-year filing history and visa type breakdown — use h1b_records
  // (company_id FK confirmed via /api/h1b/records). Gracefully empty if absent.
  const [yearResult, visaResult, salaryResult] = await Promise.all([
    pool.query<{ year: number; total: string }>(
      `SELECT year, (approved + denied)::int AS total
       FROM h1b_records
       WHERE company_id = $1
         AND year IS NOT NULL
       ORDER BY year DESC
       LIMIT 5`,
      [id]
    ).catch(() => ({ rows: [] as Array<{ year: number; total: string }> })),
    pool.query<{ visa_class: string; count: string }>(
      `SELECT visa_class, COUNT(*)::text AS count
       FROM lca_records
       WHERE company_id = $1
       GROUP BY visa_class
       ORDER BY count DESC
       LIMIT 6`,
      [id]
    ).catch(() => ({ rows: [] as Array<{ visa_class: string; count: string }> })),
    pool.query<{ avg_salary: string | null }>(
      `SELECT AVG((wage_rate_from + COALESCE(wage_rate_to, wage_rate_from)) / 2)::text AS avg_salary
       FROM lca_records
       WHERE company_id = $1
         AND wage_unit = 'Year'
         AND wage_rate_from > 10000`,
      [id]
    ).catch(() => ({ rows: [] as Array<{ avg_salary: string | null }> })),
  ])

  const score = coercedSponsorshipPercent(company.sponsorship_confidence)
  const totalFilings = stats ? Number(stats.total_applications ?? 0) : 0
  const certRate = stats?.certification_rate != null ? Math.round(Number(stats.certification_rate) * 100) / 100 : null
  const denialRate = stats && stats.total_applications && Number(stats.total_applications) > 0
    ? Math.round((Number(stats.total_denied ?? 0) / Number(stats.total_applications)) * 100) / 100
    : null
  const avgSalary = salaryResult.rows[0]?.avg_salary ? Math.round(Number(salaryResult.rows[0].avg_salary)) : null

  const verdict = computeVerdict({
    sponsorshipConfidence: score,
    sponsorsH1b: company.sponsors_h1b,
    totalFilings,
  })

  const filingsByYear: SponsorshipTruthData["filingsByYear"] = yearResult.rows.map((r) => ({
    year: Number(r.year),
    total: Number(r.total),
  }))

  const visaTypes: SponsorshipTruthData["visaTypes"] = visaResult.rows.map((r) => ({
    type: r.visa_class,
    count: Number(r.count),
  }))

  const body: SponsorshipTruthData = {
    score,
    verdict,
    totalFilings,
    certRate,
    denialRate,
    avgSalary,
    filingsByYear,
    visaTypes,
    employerClaim: company.sponsors_h1b,
    approvalTrend: stats?.approval_trend ?? null,
    isStaffingFirm: stats?.is_staffing_firm ?? false,
    hasHighDenialRate: stats?.has_high_denial_rate ?? false,
    dataSource: "DOL LCA public data · USCIS petition records",
    lastUpdated: company.updated_at,
  }

  return NextResponse.json(body)
}
