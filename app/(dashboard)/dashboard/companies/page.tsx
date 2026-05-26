import { getPostgresPool } from "@/lib/postgres/server"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import type { Company, CompanySize } from "@/types"
import CompaniesPageClient from "./CompaniesPageClient"

export const dynamic = "force-dynamic"

const PAGE_SIZE = 24

const SIZE_VALUES = new Set<CompanySize>([
  "startup",
  "small",
  "medium",
  "large",
  "enterprise",
])

const SORT_MAP: Record<string, { col: string; asc: boolean }> = {
  job_count: { col: "companies.job_count", asc: false },
  sponsorship_confidence: { col: "companies.sponsorship_confidence", asc: false },
  created_at: { col: "companies.created_at", asc: false },
  name: { col: "companies.name", asc: true },
  h1b_sponsor_count_1yr: { col: "companies.h1b_sponsor_count_1yr", asc: false },
  health_score: { col: "chs.total_score", asc: false },
}

type CompaniesPageSearchParams = Record<string, string | string[] | undefined>

type CompaniesInitialData = {
  initialCompanies: Company[]
  initialTotal: number
  initialIndustries: string[]
  initialNewTodayByCompanyId: Record<string, number>
  initialCompaniesLoaded: boolean
  initialIndustriesLoaded: boolean
  initialNewTodayLoaded: boolean
  initialQueryKey: string
}

function firstParam(params: CompaniesPageSearchParams, key: string): string {
  const value = params[key]
  if (Array.isArray(value)) return value[0] ?? ""
  return value ?? ""
}

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
}

function parseBooleanFlag(value: string): boolean {
  return value === "1" || value === "true"
}

function buildQueryKey(input: {
  industries: string[]
  sizes: CompanySize[]
  ats: string
  sponsorsH1b: boolean
  hasJobs: boolean
  sort: string
  q: string
}): string {
  return JSON.stringify({
    industries: input.industries,
    sizes: input.sizes,
    ats: input.ats,
    sponsorsH1b: input.sponsorsH1b,
    hasJobs: input.hasJobs,
    sort: input.sort,
    q: input.q.trim(),
  })
}

async function getCompaniesInitialData(params: CompaniesPageSearchParams): Promise<CompaniesInitialData> {
  const selectedIndustries = parseCsv(firstParam(params, "industry"))
  const selectedSizes = parseCsv(firstParam(params, "size")).filter(
    (size): size is CompanySize => SIZE_VALUES.has(size as CompanySize)
  )
  const selectedAts = firstParam(params, "ats")
  const sponsorsH1b = parseBooleanFlag(firstParam(params, "sponsors_h1b"))
  const hasJobs = parseBooleanFlag(firstParam(params, "has_jobs"))
  const q = firstParam(params, "q")
  const sortParam = firstParam(params, "sort")
  const sort = SORT_MAP[sortParam] ? sortParam : "job_count"
  const initialQueryKey = buildQueryKey({
    industries: selectedIndustries,
    sizes: selectedSizes,
    ats: selectedAts,
    sponsorsH1b,
    hasJobs,
    sort,
    q,
  })

  const fallback: CompaniesInitialData = {
    initialCompanies: [],
    initialTotal: 0,
    initialIndustries: [],
    initialNewTodayByCompanyId: {},
    initialCompaniesLoaded: false,
    initialIndustriesLoaded: false,
    initialNewTodayLoaded: false,
    initialQueryKey,
  }

  const where: string[] = ["companies.is_active = true"]
  const values: Array<string | string[] | number | boolean> = []
  const addParam = (value: string | string[] | number | boolean) => {
    values.push(value)
    return `$${values.length}`
  }

  if (q.trim()) {
    where.push(`companies.name ILIKE ${addParam(`%${q.trim()}%`)}`)
  }
  if (selectedIndustries.length === 1) {
    where.push(`companies.industry = ${addParam(selectedIndustries[0])}`)
  } else if (selectedIndustries.length > 1) {
    where.push(`companies.industry = ANY(${addParam(selectedIndustries)}::text[])`)
  }
  if (selectedSizes.length === 1) {
    where.push(`companies.size = ${addParam(selectedSizes[0])}`)
  } else if (selectedSizes.length > 1) {
    where.push(`companies.size = ANY(${addParam(selectedSizes)}::text[])`)
  }
  if (selectedAts) where.push(`companies.ats_type = ${addParam(selectedAts)}`)
  if (sponsorsH1b) where.push("companies.sponsors_h1b = true")
  if (hasJobs) where.push("companies.job_count > 0")

  const { col, asc } = SORT_MAP[sort] ?? SORT_MAP.job_count

  const limitParam = addParam(PAGE_SIZE)
  const offsetParam = addParam(0)

  const pool = getPostgresPool()

  const [companiesResult, industriesResult, newTodayResult] = await Promise.allSettled([
    pool.query<Record<string, unknown> & { total_count: string }>(
      `SELECT
         companies.*,
         chs.total_score AS health_score,
         chs.verdict AS health_verdict,
         chs.glassdoor_rating,
         COUNT(*) OVER()::text AS total_count
       FROM companies
       LEFT JOIN company_health_scores chs ON chs.company_id = companies.id
       WHERE ${where.join(" AND ")}
       ORDER BY ${col} ${asc ? "ASC" : "DESC"} NULLS LAST
       LIMIT ${limitParam}
       OFFSET ${offsetParam}`,
      values,
    ),
    pool.query<{ industry: string | null }>(
      `SELECT DISTINCT industry
       FROM companies
       WHERE is_active = true
         AND industry IS NOT NULL
       ORDER BY industry ASC`,
    ),
    pool.query<{ company_id: string; n: number }>(
      `SELECT jobs.company_id::text AS company_id, COUNT(*)::int AS n
       FROM jobs
       LEFT JOIN companies c ON c.id = jobs.company_id
       WHERE jobs.is_active = true
         AND ${sqlJobLocatedInUsa("jobs", { companyAlias: "c" })}
         AND jobs.first_detected_at >= $1
       GROUP BY jobs.company_id`,
      [new Date(Date.now() - 86_400_000).toISOString()],
    ),
  ])

  const next: CompaniesInitialData = { ...fallback }

  if (companiesResult.status === "fulfilled") {
    next.initialCompaniesLoaded = true
    next.initialTotal = Number(companiesResult.value.rows[0]?.total_count ?? 0)
    next.initialCompanies = companiesResult.value.rows.map(({ total_count: _ignore, ...row }) => row as Company)
  }

  if (industriesResult.status === "fulfilled") {
    next.initialIndustriesLoaded = true
    next.initialIndustries = industriesResult.value.rows
      .map((row) => row.industry?.trim() ?? "")
      .filter(Boolean)
  }

  if (newTodayResult.status === "fulfilled") {
    next.initialNewTodayLoaded = true
    next.initialNewTodayByCompanyId = Object.fromEntries(
      newTodayResult.value.rows.map((row) => [row.company_id, row.n])
    )
  }

  return next
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<CompaniesPageSearchParams>
}) {
  const params = await searchParams
  const initialData = await getCompaniesInitialData(params)

  return (
    <CompaniesPageClient
      key={initialData.initialQueryKey}
      initialCompanies={initialData.initialCompanies}
      initialIndustries={initialData.initialIndustries}
      initialNewTodayByCompanyId={initialData.initialNewTodayByCompanyId}
      initialTotal={initialData.initialTotal}
      initialCompaniesLoaded={initialData.initialCompaniesLoaded}
      initialIndustriesLoaded={initialData.initialIndustriesLoaded}
      initialNewTodayLoaded={initialData.initialNewTodayLoaded}
    />
  )
}
