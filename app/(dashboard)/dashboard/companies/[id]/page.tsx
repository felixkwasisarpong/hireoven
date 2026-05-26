import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import type {
  Company,
  EmployerLCAStats,
  H1BRecord,
  Job,
  JobWithCompany,
} from "@/types"
import CompanyProfilePageClient from "./CompanyProfilePageClient"

export const dynamic = "force-dynamic"

type JdInsights = { sponsors: number; denies: number; neutral: number; quotes: string[] }

type CompanyProfileInitialData = {
  initialCompany: Company | null
  initialRecords: H1BRecord[]
  initialLcaStats: EmployerLCAStats | null
  initialJobs: JobWithCompany[]
  initialNewThisWeek: number
  initialJdInsights: JdInsights | null
  initialLoaded: boolean
}

function buildJdInsights(jobs: JobWithCompany[]): JdInsights {
  const sponsors = jobs.filter((job) => job.sponsors_h1b === true).length
  const denies = jobs.filter((job) => job.requires_authorization).length
  const neutral = jobs.length - sponsors - denies
  const quotes = jobs
    .map((job) => job.visa_language_detected)
    .filter((quote): quote is string => Boolean(quote))
    .slice(0, 3)
  return { sponsors, denies, neutral, quotes }
}

async function getCompanyProfileInitialData(companyId: string): Promise<CompanyProfileInitialData> {
  const fallback: CompanyProfileInitialData = {
    initialCompany: null,
    initialRecords: [],
    initialLcaStats: null,
    initialJobs: [],
    initialNewThisWeek: 0,
    initialJdInsights: null,
    initialLoaded: false,
  }

  try {
    const pool = getPostgresPool()
    const [companyResult, recordsResult, jobsResult] = await Promise.all([
      pool.query<Company>(
        `SELECT * FROM companies WHERE id = $1 LIMIT 1`,
        [companyId]
      ),
      pool.query<H1BRecord>(
        `SELECT *
         FROM h1b_records
         WHERE company_id = $1
         ORDER BY year DESC
         LIMIT 6`,
        [companyId]
      ),
      pool.query<Job>(
        `SELECT *
         FROM jobs
         WHERE company_id = $1
           AND is_active = true
           AND ${sqlJobLocatedInUsa("jobs")}
         ORDER BY first_detected_at DESC
         LIMIT 50`,
        [companyId]
      ),
    ])

    const company = companyResult.rows[0] ?? null
    if (!company) {
      return {
        ...fallback,
        initialLoaded: true,
      }
    }

    const initialJobs = jobsResult.rows.map((job) => ({
      ...job,
      company,
    }))

    const oneWeekAgo = Date.now() - 7 * 86_400_000
    const initialNewThisWeek = initialJobs.filter((job) => {
      const ts = Date.parse(job.first_detected_at)
      return Number.isFinite(ts) && ts >= oneWeekAgo
    }).length

    return {
      initialCompany: company,
      initialRecords: recordsResult.rows,
      initialLcaStats: null,
      initialJobs,
      initialNewThisWeek,
      initialJdInsights: buildJdInsights(initialJobs),
      initialLoaded: true,
    }
  } catch {
    return fallback
  }
}

export default async function CompanyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const initialData = await getCompanyProfileInitialData(id)

  return (
    <CompanyProfilePageClient
      companyId={id}
      initialCompany={initialData.initialCompany}
      initialRecords={initialData.initialRecords}
      initialLcaStats={initialData.initialLcaStats}
      initialJobs={initialData.initialJobs}
      initialNewThisWeek={initialData.initialNewThisWeek}
      initialJdInsights={initialData.initialJdInsights}
      initialLoaded={initialData.initialLoaded}
    />
  )
}
