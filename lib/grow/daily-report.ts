/**
 * Daily Fresh Jobs Report.
 *
 * Rolls up "what we discovered in the last UTC day" into a single shareable
 * snapshot — the headline numbers (new jobs, AI roles, remote, new-grad,
 * companies hiring, companies with sponsorship history) plus the top companies,
 * roles, and locations. Written nightly by `api/cron/daily-report`, stored in
 * `daily_job_reports` (see scripts/migrations/add-daily-job-reports.sql), and
 * read by the public `/report` pages and the OG card.
 *
 * Dates are UTC, matching the rest of the admin stats layer (lib/admin/time.ts).
 */

import type { Pool } from "pg"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"

export interface DailyReportTotals {
  newJobs: number
  aiJobs: number
  remoteJobs: number
  newGradJobs: number
  companiesHiring: number
  /** Distinct companies posting today that have documented H-1B sponsorship. */
  sponsorCompanies: number
}

export interface DailyReportCompany {
  id: string
  name: string
  domain: string | null
  logoUrl: string | null
  industry: string | null
  jobCount: number
  sponsorsH1b: boolean
}

export interface DailyReportRole {
  title: string
  count: number
}

export interface DailyReportLocation {
  location: string
  count: number
}

export interface DailyReport {
  /** UTC calendar day, YYYY-MM-DD. */
  date: string
  generatedAt: string
  totals: DailyReportTotals
  topCompanies: DailyReportCompany[]
  topRoles: DailyReportRole[]
  topLocations: DailyReportLocation[]
}

/**
 * SQL boolean (no leading AND) matching AI / ML roles by title. Word-boundary
 * regex for the short tokens (`ai`, `ml`, `llm`, `nlp`) so we don't match
 * "email", "html", "detail", "maintain"; plain phrase matches for the rest.
 */
function aiRoleSql(alias: string): string {
  const t = `${alias}.title`
  return `(
    ${t} ~* '\\m(ai|ml|llm|nlp|genai)\\M'
    OR ${t} ILIKE '%machine learning%'
    OR ${t} ILIKE '%artificial intelligence%'
    OR ${t} ILIKE '%deep learning%'
    OR ${t} ILIKE '%generative ai%'
    OR ${t} ILIKE '%computer vision%'
    OR ${t} ILIKE '%data scientist%'
    OR ${t} ILIKE '%mlops%'
    OR ${t} ILIKE '%applied scientist%'
    OR ${t} ILIKE '%research scientist%'
  )`
}

/** SQL boolean (no leading AND) matching entry-level / new-grad roles. */
function newGradSql(alias: string): string {
  const t = `${alias}.title`
  return `(
    ${alias}.seniority_level IN ('intern', 'junior')
    OR ${t} ILIKE '%new grad%'
    OR ${t} ILIKE '%new graduate%'
    OR ${t} ILIKE '%university graduate%'
    OR ${t} ILIKE '%entry level%'
    OR ${t} ILIKE '%entry-level%'
    OR ${t} ILIKE '%early career%'
    OR ${t} ILIKE '%recent graduate%'
  )`
}

/** Normalize an input to a YYYY-MM-DD UTC day string. */
export function toReportDate(input?: string | Date): string {
  const d = input ? new Date(input) : new Date()
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid report date: ${String(input)}`)
  }
  return d.toISOString().slice(0, 10)
}

/** [start, end) UTC timestamptz bounds for a YYYY-MM-DD day. */
function dayBounds(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid report date: ${date}`)
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * Compute the report for a single UTC day from live job data. Only reliable for
 * days still inside the retention window — older days must be read from the
 * stored snapshot via {@link getStoredReport}.
 */
export async function buildDailyReport(pool: Pool, date: string): Promise<DailyReport> {
  const { start, end } = dayBounds(date)
  const usa = sqlJobLocatedInUsa("j", { companyAlias: "c" })
  const window = `
    j.is_active = true
    AND j.first_detected_at >= $1::timestamptz
    AND j.first_detected_at <  $2::timestamptz
    AND ${usa}
  `

  const [totalsRes, companiesRes, rolesRes, locationsRes] = await Promise.all([
    pool.query<{
      new_jobs: number
      ai_jobs: number
      remote_jobs: number
      new_grad_jobs: number
      companies_hiring: number
      sponsor_companies: number
    }>(
      `SELECT
         COUNT(*)::int                                                          AS new_jobs,
         COUNT(*) FILTER (WHERE ${aiRoleSql("j")})::int                         AS ai_jobs,
         COUNT(*) FILTER (WHERE j.is_remote = true)::int                        AS remote_jobs,
         COUNT(*) FILTER (WHERE ${newGradSql("j")})::int                        AS new_grad_jobs,
         COUNT(DISTINCT j.company_id)::int                                      AS companies_hiring,
         COUNT(DISTINCT j.company_id) FILTER (
           WHERE c.sponsors_h1b = true OR COALESCE(c.h1b_sponsor_count_1yr, 0) > 0
         )::int                                                                 AS sponsor_companies
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
       WHERE ${window}`,
      [start, end],
    ),
    pool.query<{
      id: string
      name: string
      domain: string | null
      logo_url: string | null
      industry: string | null
      job_count: number
      sponsors_h1b: boolean | null
    }>(
      `SELECT c.id, c.name, c.domain, c.logo_url, c.industry,
              COUNT(*)::int AS job_count,
              (c.sponsors_h1b = true OR COALESCE(c.h1b_sponsor_count_1yr, 0) > 0) AS sponsors_h1b
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
        WHERE ${window}
        GROUP BY c.id, c.name, c.domain, c.logo_url, c.industry, c.sponsors_h1b, c.h1b_sponsor_count_1yr
        ORDER BY job_count DESC, c.name ASC
        LIMIT 12`,
      [start, end],
    ),
    pool.query<{ title: string; n: number }>(
      `SELECT COALESCE(NULLIF(btrim(j.normalized_title), ''), j.title) AS title,
              COUNT(*)::int AS n
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
        WHERE ${window}
        GROUP BY 1
        ORDER BY n DESC, 1 ASC
        LIMIT 10`,
      [start, end],
    ),
    pool.query<{ location: string; n: number }>(
      `SELECT CASE WHEN j.is_remote = true THEN 'Remote'
                   ELSE btrim(j.location) END AS location,
              COUNT(*)::int AS n
         FROM jobs j
         JOIN companies c ON c.id = j.company_id
        WHERE ${window}
          AND (j.is_remote = true OR btrim(COALESCE(j.location, '')) <> '')
        GROUP BY 1
        ORDER BY n DESC, 1 ASC
        LIMIT 10`,
      [start, end],
    ),
  ])

  const t = totalsRes.rows[0]
  return {
    date,
    generatedAt: new Date().toISOString(),
    totals: {
      newJobs: t?.new_jobs ?? 0,
      aiJobs: t?.ai_jobs ?? 0,
      remoteJobs: t?.remote_jobs ?? 0,
      newGradJobs: t?.new_grad_jobs ?? 0,
      companiesHiring: t?.companies_hiring ?? 0,
      sponsorCompanies: t?.sponsor_companies ?? 0,
    },
    topCompanies: companiesRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      domain: r.domain,
      logoUrl: r.logo_url,
      industry: r.industry,
      jobCount: r.job_count,
      sponsorsH1b: Boolean(r.sponsors_h1b),
    })),
    topRoles: rolesRes.rows.map((r) => ({ title: r.title, count: r.n })),
    topLocations: locationsRes.rows.map((r) => ({ location: r.location, count: r.n })),
  }
}

/** Upsert a computed report into durable storage (idempotent per day). */
export async function storeDailyReport(pool: Pool, report: DailyReport): Promise<void> {
  await pool.query(
    `INSERT INTO daily_job_reports (report_date, generated_at, payload)
     VALUES ($1::date, $2::timestamptz, $3::jsonb)
     ON CONFLICT (report_date)
     DO UPDATE SET generated_at = EXCLUDED.generated_at, payload = EXCLUDED.payload`,
    [report.date, report.generatedAt, JSON.stringify(report)],
  )
}

/** Read a stored report by UTC day, or null if none was captured. */
export async function getStoredReport(pool: Pool, date: string): Promise<DailyReport | null> {
  const { rows } = await pool.query<{ payload: DailyReport }>(
    `SELECT payload FROM daily_job_reports WHERE report_date = $1::date`,
    [date],
  )
  return rows[0]?.payload ?? null
}

/** Read the most recent stored report, or null if none exist yet. */
export async function getLatestReport(pool: Pool): Promise<DailyReport | null> {
  const { rows } = await pool.query<{ payload: DailyReport }>(
    `SELECT payload FROM daily_job_reports ORDER BY report_date DESC LIMIT 1`,
  )
  return rows[0]?.payload ?? null
}

/** Recent report dates (newest first) for building the archive / prev-next nav. */
export async function listReportDates(pool: Pool, limit = 30): Promise<string[]> {
  const { rows } = await pool.query<{ report_date: string }>(
    `SELECT to_char(report_date, 'YYYY-MM-DD') AS report_date
       FROM daily_job_reports ORDER BY report_date DESC LIMIT $1`,
    [limit],
  )
  return rows.map((r) => r.report_date)
}

/**
 * Generate and persist today's (or a given day's) report. Returns the report so
 * the cron can echo the headline numbers.
 */
export async function generateAndStoreReport(pool: Pool, date?: string): Promise<DailyReport> {
  const day = toReportDate(date)
  const report = await buildDailyReport(pool, day)
  await storeDailyReport(pool, report)
  return report
}
