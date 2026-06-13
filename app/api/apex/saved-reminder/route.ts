import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { getPostgresPool } from "@/lib/postgres/server"
import { companyLogoUrlFromDomain } from "@/lib/companies/logo-url"

export const runtime = "nodejs"
export const maxDuration = 10

/**
 * Recently-saved-but-not-applied jobs for the dashboard reminder popup.
 * Scoped to jobs saved within the last 3 days (fresh intent — nudge to apply
 * before momentum fades). Distinct from the proactive snapshot's
 * `staleSavedJobs`, which is the opposite (saved 10+ days ago).
 */
export type SavedReminderJob = {
  applicationId: string
  jobId: string | null
  jobTitle: string
  companyName: string
  daysOld: number
  logoUrl: string | null
}

type Row = {
  application_id: string
  job_id: string | null
  job_title: string
  company_name: string | null
  created_at: string
  company_logo_url: string | null
  canonical_logo_url: string | null
  company_domain: string | null
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const pool = getPostgresPool()
    const { rows } = await pool.query<Row>(
      `SELECT
         ja.id AS application_id,
         ja.job_id,
         ja.job_title,
         ja.company_name,
         ja.created_at,
         ja.company_logo_url,
         companies.logo_url AS canonical_logo_url,
         companies.domain AS company_domain
       FROM job_applications ja
       LEFT JOIN jobs ON jobs.id = ja.job_id
       LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE ja.user_id = $1
         AND ja.is_archived = false
         AND ja.status = 'saved'
         AND ja.created_at >= NOW() - INTERVAL '3 days'
       ORDER BY ja.created_at DESC
       LIMIT 12`,
      [user.id]
    )

    const jobs: SavedReminderJob[] = rows.map((r) => {
      // Prefer the company's canonical stored logo, then the per-application
      // captured logo, then derive from the company's brand domain. (Companies
      // discovered via an ATS host return "" from companyLogoUrlFromDomain, so
      // those fall through to null and the UI shows a gradient-initials avatar.)
      const fromDomain = r.company_domain ? companyLogoUrlFromDomain(r.company_domain) : ""
      return {
        applicationId: r.application_id,
        jobId: r.job_id,
        jobTitle: r.job_title,
        companyName: r.company_name?.trim() || "A company",
        daysOld: Math.max(
          0,
          Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000)
        ),
        logoUrl:
          r.canonical_logo_url?.trim() || r.company_logo_url?.trim() || fromDomain || null,
      }
    })

    return NextResponse.json(
      { jobs, total: jobs.length },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    console.error("[apex/saved-reminder] error:", error)
    return NextResponse.json({ jobs: [], total: 0 })
  }
}
