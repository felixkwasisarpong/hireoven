import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { getAlertsFromEmail } from "@/lib/email/identity"
import { requireCronAuth } from "@/lib/env"
import { matchesLocationFilter } from "@/lib/jobs/search-match"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Job, JobAlert, Profile } from "@/types"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
}

function matchesAlert(alert: JobAlert, job: Job): boolean {
  if (alert.sponsorship_required && !job.sponsors_h1b && (job.sponsorship_score ?? 0) <= 60) return false
  if (alert.remote_only && !job.is_remote) return false
  if (alert.seniority_levels?.length && job.seniority_level && !alert.seniority_levels.includes(job.seniority_level)) return false
  if (alert.employment_types?.length && job.employment_type && !alert.employment_types.includes(job.employment_type)) return false
  if (alert.company_ids?.length && !alert.company_ids.includes(job.company_id)) return false

  if (alert.keywords?.length) {
    const haystack = `${job.title} ${job.normalized_title ?? ""} ${(job.skills ?? []).join(" ")}`.toLowerCase()
    const hit = alert.keywords.some((kw) => haystack.includes(kw.toLowerCase()))
    if (!hit) return false
  }

  if (alert.locations?.length) {
    const hit = alert.locations.some((entry) =>
      matchesLocationFilter(job.location, entry, { isRemote: job.is_remote })
    )
    if (!hit) return false
  }

  return true
}

function jobCard(job: Job & { company_name?: string }): string {
  const base = getBaseUrl()
  const salary =
    job.salary_min && job.salary_max
      ? `$${Math.round(job.salary_min / 1000)}k–$${Math.round(job.salary_max / 1000)}k`
      : null
  const tags = [
    job.is_remote ? "Remote" : job.location,
    job.seniority_level ? job.seniority_level.charAt(0).toUpperCase() + job.seniority_level.slice(1) : null,
    salary,
    job.sponsors_h1b ? "Sponsors H1B" : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
        <a href="${job.apply_url}" style="font-size:15px;font-weight:600;color:#0369A1;text-decoration:none;">
          ${job.title}
        </a>
        <div style="font-size:13px;color:#64748b;margin-top:2px;">${job.company_name ?? ""}</div>
        ${tags ? `<div style="font-size:12px;color:#94a3b8;margin-top:4px;">${tags}</div>` : ""}
      </td>
    </tr>`
}

function buildDigestEmail(
  profile: Pick<Profile, "full_name" | "email">,
  sections: Array<{ alertName: string; jobs: Array<Job & { company_name?: string }> }>,
  totalCount: number,
  windowLabel: string
): string {
  const base = getBaseUrl()
  const name = profile.full_name?.split(" ")[0] ?? "there"

  const sectionsHtml = sections
    .map(
      ({ alertName, jobs }) => `
      <tr><td style="padding:20px 0 8px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">
          ${alertName}
        </div>
      </td></tr>
      ${jobs.map(jobCard).join("")}`
    )
    .join("")

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;max-width:600px;">

        <!-- Header -->
        <tr><td style="background:#0369A1;padding:28px 32px;">
          <div style="font-size:20px;font-weight:700;color:#fff;letter-spacing:-0.02em;">Hireoven</div>
          <div style="font-size:13px;color:#bae6fd;margin-top:4px;">Jobs served fresh</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 6px;font-size:22px;font-weight:700;color:#0f172a;">
            Hey ${name} 👋
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#64748b;line-height:1.6;">
            You have <strong style="color:#0369A1;">${totalCount} new job${totalCount === 1 ? "" : "s"}</strong> matching your alerts ${windowLabel}.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0">
            ${sectionsHtml}
          </table>

          <div style="margin-top:32px;text-align:center;">
            <a href="${base}/dashboard"
               style="display:inline-block;background:#0369A1;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">
              View all on Hireoven →
            </a>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #f1f5f9;background:#f8fafc;">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
            You're receiving this because you have ${windowLabel} alerts enabled.
            <a href="${base}/dashboard/onboarding" style="color:#0369A1;">Manage preferences</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!resend) {
    return NextResponse.json({ skipped: true, reason: "RESEND_API_KEY not configured" })
  }

  const pool = getPostgresPool()
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()

  // Fetch all daily-frequency users with active alerts
  const usersResult = await pool.query<Pick<Profile, "id" | "email" | "full_name" | "email_alerts">>(
    `SELECT id, email, full_name, email_alerts
     FROM profiles
     WHERE alert_frequency = 'daily'
       AND email_alerts = true
       AND email IS NOT NULL`
  )
  const users = usersResult.rows

  if (!users?.length) return NextResponse.json({ sent: 0, reason: "no daily users" })

  // Fetch all jobs posted in last 24h
  const recentJobsResult = await pool.query<(Job & { company_name: string })>(
    `SELECT jobs.*, companies.name AS company_name
     FROM jobs
     LEFT JOIN companies ON companies.id = jobs.company_id
     WHERE jobs.is_active = true
       AND ${sqlJobLocatedInUsa("jobs")}
       AND jobs.first_detected_at >= $1
     ORDER BY jobs.first_detected_at DESC`,
    [since]
  )
  const recentJobs = recentJobsResult.rows

  if (!recentJobs?.length) return NextResponse.json({ sent: 0, reason: "no new jobs" })

  type JobWithCompanyName = Job & { company_name: string }
  const flatJobs = recentJobs as JobWithCompanyName[]

  let sent = 0
  let errors = 0

  for (const user of users) {
    const alertsResult = await pool.query<JobAlert>(
      `SELECT *
       FROM job_alerts
       WHERE user_id = $1
         AND is_active = true`,
      [user.id]
    )
    const alerts = alertsResult.rows

    if (!alerts?.length) continue

    const sections: Array<{ alertName: string; jobs: typeof flatJobs }> = []
    let totalCount = 0

    for (const alert of alerts) {
      const matched = flatJobs.filter((job) => matchesAlert(alert, job)).slice(0, 5)
      if (!matched.length) continue
      sections.push({ alertName: alert.name ?? "Untitled alert", jobs: matched })
      totalCount += matched.length
    }

    if (!sections.length) continue

    try {
      await resend.emails.send({
        from: getAlertsFromEmail(),
        to: user.email!,
        subject: `Your daily job digest - ${totalCount} new match${totalCount === 1 ? "" : "es"}`,
        html: buildDigestEmail(user, sections, totalCount, "today"),
      })
      sent++
    } catch {
      errors++
    }
  }

  return NextResponse.json({ sent, errors, window: "24h" })
}
