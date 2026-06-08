import { NextRequest, NextResponse } from "next/server"
import { calculateOfferRisk, analyzeOfferForNegotiation } from "@/lib/offers/offer-risk-analyzer"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import type {
  Company,
  EmployerLCAStats,
  LCARecord,
  LcaWageRecord,
  OfferRiskCompanySnapshot,
  OfferRiskInput,
} from "@/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function cleanLike(value: string) {
  const cleaned = value.replace(/%/g, "").replace(/_/g, "").trim()
  return cleaned ? `%${cleaned}%` : null
}

function normalizeState(location: string | null | undefined) {
  const last = location?.split(",").map((part) => part.trim()).filter(Boolean).at(-1)
  return last && /^[A-Za-z]{2}$/.test(last) ? last.toUpperCase() : null
}

function toWageRecord(record: LCARecord): LcaWageRecord {
  return {
    employerName: record.employer_name,
    jobTitle: record.job_title,
    roleFamily: record.soc_title,
    location: [record.worksite_city, record.worksite_state_abbr].filter(Boolean).join(", ") || null,
    worksiteState: record.worksite_state_abbr,
    wageRateFrom: record.wage_rate_from,
    wageRateTo: record.wage_rate_to,
    wageUnit: record.wage_unit,
    prevailingWage: record.prevailing_wage,
    wageLevel: record.wage_level,
    fiscalYear: record.fiscal_year,
    decisionDate: record.decision_date,
  }
}

function companySnapshot(
  company: Company | null,
  stats: EmployerLCAStats | null
): OfferRiskCompanySnapshot | null {
  if (!company && !stats) return null

  return {
    companyName: company?.name ?? stats?.display_name ?? null,
    sponsorsH1b: company?.sponsors_h1b ?? ((stats?.total_applications ?? 0) > 0 ? true : null),
    sponsorshipConfidence: company?.sponsorship_confidence ?? null,
    recentH1BCount: company?.h1b_sponsor_count_1yr ?? null,
    totalLcaCount: stats?.total_applications ?? company?.h1b_sponsor_count_3yr ?? null,
    certificationRate: stats?.certification_rate ?? null,
    topJobTitles: stats?.top_job_titles?.map((item) => item.title).slice(0, 6) ?? [],
    topWorksiteStates: stats?.top_states?.map((item) => item.state).slice(0, 6) ?? [],
    eVerifyLikely: null,
  }
}

async function enrichInput(input: OfferRiskInput): Promise<OfferRiskInput> {
  const pool = getPostgresPool()
  const companyQuery = cleanLike(input.company)
  if (!companyQuery) return input

  const [companyResult, statsResult] = await Promise.all([
    pool.query<Company>(
      `SELECT *
       FROM companies
       WHERE name ILIKE $1
       ORDER BY sponsors_h1b DESC, sponsorship_confidence DESC NULLS LAST, job_count DESC
       LIMIT 1`,
      [companyQuery]
    ),
    pool.query<EmployerLCAStats>(
      `SELECT *
       FROM employer_lca_stats
       WHERE display_name ILIKE $1 OR employer_name_normalized ILIKE $1
       ORDER BY total_applications DESC
       LIMIT 1`,
      [companyQuery]
    ),
  ])

  const company = companyResult.rows[0] ?? null
  const stats = statsResult.rows[0] ?? null
  const lcaEmployer = stats?.display_name ?? company?.name ?? input.company
  const state = normalizeState(input.location)
  const titleLike = cleanLike(input.jobTitle)

  const values: unknown[] = [cleanLike(lcaEmployer) ?? companyQuery]
  const where = ["employer_name ILIKE $1"]

  if (titleLike) {
    values.push(titleLike)
    where.push(`job_title ILIKE $${values.length}`)
  }

  if (state) {
    values.push(state)
    where.push(`worksite_state_abbr = $${values.length}`)
  }

  const lcaResult = await pool.query<LCARecord>(
    `SELECT *
     FROM lca_records
     WHERE ${where.join(" AND ")}
     ORDER BY decision_date DESC NULLS LAST
     LIMIT 80`,
    values
  )

  return {
    ...input,
    companySnapshot: input.companySnapshot ?? companySnapshot(company, stats),
    lcaRecords: input.lcaRecords?.length ? input.lcaRecords : lcaResult.rows.map(toWageRecord),
  }
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const includeNegotiation = searchParams.get("includeNegotiation") === "true"

  let body: OfferRiskInput & {
    offerDetails?: {
      base_salary?: number
      equity?: string
      signing_bonus?: number
      annual_bonus_target?: number
      benefits_notes?: string
      offer_deadline?: string
    }
    companyIdForNegotiation?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const input: OfferRiskInput = body

  try {
    const enriched = await enrichInput(input)
    const analysis = calculateOfferRisk(enriched)

    if (!includeNegotiation) {
      return NextResponse.json({
        analysis,
        enrichedInput: {
          companySnapshot: enriched.companySnapshot ?? null,
          lcaRecordCount: enriched.lcaRecords?.length ?? 0,
        },
      })
    }

    // Negotiation analysis — requires offer details
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const pool = getPostgresPool()
    let userProfile: { visa_status: string | null; top_skills: string[] | null; desired_locations: string[] | null } | null = null
    if (user) {
      const profileResult = await pool.query<{
        visa_status: string | null
        top_skills: string[] | null
        desired_locations: string[] | null
      }>(
        `SELECT p.visa_status, p.desired_locations,
                (SELECT top_skills FROM resumes
                 WHERE user_id = p.id AND is_primary = true AND parse_status = 'complete'
                 ORDER BY updated_at DESC LIMIT 1) AS top_skills
         FROM profiles p WHERE p.id = $1`,
        [user.id]
      )
      userProfile = profileResult.rows[0] ?? null
    }

    const offerDetails = body.offerDetails ?? {
      base_salary: input.salary ?? input.salaryMin ?? undefined,
    }

    const companyId = body.companyIdForNegotiation ??
      enriched.companySnapshot?.companyName
        ? (await pool.query<{ id: string }>(
            `SELECT id FROM companies WHERE name ILIKE $1 LIMIT 1`,
            [enriched.companySnapshot?.companyName ?? input.company]
          )).rows[0]?.id
        : undefined

    const negotiationAnalysis = await analyzeOfferForNegotiation(
      offerDetails,
      companyId ?? "",
      input.jobTitle,
      {
        visaStatus: userProfile?.visa_status,
        needsSponsorship: AUTH_NEEDS_SUPPORT.has(input.workAuthorizationStatus),
        location: input.location ?? userProfile?.desired_locations?.[0],
        topSkills: userProfile?.top_skills ?? [],
      }
    )

    return NextResponse.json({
      analysis,
      negotiationAnalysis,
      enrichedInput: {
        companySnapshot: enriched.companySnapshot ?? null,
        lcaRecordCount: enriched.lcaRecords?.length ?? 0,
      },
    })
  } catch (error) {
    return NextResponse.json({
      analysis: calculateOfferRisk(input),
      enrichmentWarning: error instanceof Error ? error.message : "Could not enrich offer risk analysis.",
    })
  }
}

const AUTH_NEEDS_SUPPORT = new Set([
  "F1_OPT", "F1_STEM_OPT", "H1B", "needs_future_sponsorship", "unknown",
])
