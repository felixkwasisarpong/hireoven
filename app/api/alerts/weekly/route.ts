import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { getAlertsFromEmail } from "@/lib/email/identity"
import { requireCronAuth } from "@/lib/env"
import { matchesLocationFilter } from "@/lib/jobs/search-match"
import { createAdminClient } from "@/lib/supabase/admin"
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
    if (!alert.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) return false
  }
  if (alert.locations?.length) {
    if (
      !alert.locations.some((entry) =>
        matchesLocationFilter(job.location, entry, { isRemote: job.is_remote })
      )
    ) {
      return false
    }
  }
  return true
}

function jobRow(job: Job & { company_name?: string }): string {
  const salary =
    job.salary_min && job.salary_max
      ? `$${Math.round(job.salary_min / 1000)}k–$${Math.round(job.salary_max / 1000)}k`
      : null
  const meta = [
    job.is_remote ? "Remote" : job.location,
    salary,
    job.sponsors_h1b ? "✓ H1B" : null,
  ].filter(Boolean).join(" · ")

  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
      <a href="${job.apply_url}" style="font-size:14px;font-weight:600;color:#0369A1;text-decoration:none;">${job.title}</a>
      <div style="font-size:12px;color:#64748b;">${job.company_name ?? ""} ${meta ? `· ${meta}` : ""}</div>
    </td></tr>`
}

function buildWeeklyEmail(
  profile: Pick<Profile, "full_name" | "email">,
  sections: Array<{ alertName: string; jobs: Array<Job & { company_name?: string }> }>,
  totalCount: number,
  platformStats: { totalNewJobs: number; topCompanies: string[]; newCompanies: number }
): string {
  const base = getBaseUrl()
  const name = profile.full_name?.split(" ")[0] ?? "there"

  const topCompaniesHtml = platformStats.topCompanies.length
    ? `<div style="margin:4px 0 0;font-size:13px;color:#475569;">
        Top hiring: ${platformStats.topCompanies.slice(0, 3).join(", ")}
      </div>`
    : ""

  const sectionsHtml = sections
    .map(({ alertName, jobs }) => `
      <tr><td style="padding:18px 0 6px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">${alertName}</div>
      </td></tr>
      ${jobs.map(jobRow).join("")}`)
    .join("")

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;max-width:600px;">

        <tr><td style="background:#0369A1;padding:28px 32px;border-radius:16px 16px 0 0;">
          <div style="font-size:20px;font-weight:700;color:#fff;">Hireoven</div>
          <div style="font-size:13px;color:#bae6fd;margin-top:2px;">Your weekly hiring digest</div>
        </td></tr>

        <!-- Platform stats -->
        <tr><td style="padding:24px 32px;background:#f0f9ff;border-bottom:1px solid #e0f2fe;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#0369A1;margin-bottom:10px;">
            This week in hiring
          </div>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="text-align:center;padding:0 8px;">
                <div style="font-size:24px;font-weight:700;color:#0369A1;">${platformStats.totalNewJobs.toLocaleString()}</div>
                <div style="font-size:11px;color:#64748b;">new jobs posted</div>
              </td>
              <td style="text-align:center;padding:0 8px;border-left:1px solid #bae6fd;">
                <div style="font-size:24px;font-weight:700;color:#0369A1;">${platformStats.newCompanies}</div>
                <div style="font-size:11px;color:#64748b;">new companies</div>
              </td>
            </tr>
          </table>
          ${topCompaniesHtml}
        </td></tr>

        <tr><td style="padding:28px 32px;">
          <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#0f172a;">Hey ${name} 👋</p>
          <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
            <strong style="color:#0369A1;">${totalCount} new job${totalCount === 1 ? "" : "s"}</strong> matched your alerts this week.
          </p>

          <table width="100%" cellpadding="0" cellspacing="0">${sectionsHtml}</table>

          <div style="margin-top:32px;text-align:center;">
            <a href="${base}/dashboard" style="display:inline-block;background:#0369A1;color:#fff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:10px;text-decoration:none;">
              View all on Hireoven →
            </a>
          </div>
        </td></tr>

        <tr><td style="padding:20px 32px;border-top:1px solid #f1f5f9;background:#f8fafc;border-radius:0 0 16px 16px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
            Weekly digest · <a href="${base}/dashboard/onboarding" style="color:#0369A1;">Manage preferences</a>
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

  const supabase = createAdminClient()
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const weekStart = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()

  // Platform stats for "this week in hiring" section
  const [jobsCountResult, newCompaniesResult, topCompaniesResult] = await Promise.all([
    supabase.from("jobs").select("*", { count: "exact", head: true }).gte("first_detected_at", weekStart),
    supabase.from("companies").select("*", { count: "exact", head: true }).gte("created_at", weekStart),
    supabase
      .from("jobs")
      .select("company:companies(name)")
      .gte("first_detected_at", weekStart)
      .eq("is_active", true)
      .limit(500),
  ])

  // Count jobs per company for top hiring
  const companyCounts = new Map<string, number>()
  for (const row of (topCompaniesResult.data ?? []) as any[]) {
    const name = row.company?.name
    if (name) companyCounts.set(name, (companyCounts.get(name) ?? 0) + 1)
  }
  const topCompanies = [...companyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name)

  const platformStats = {
    totalNewJobs: jobsCountResult.count ?? 0,
    newCompanies: newCompaniesResult.count ?? 0,
    topCompanies,
  }

  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, full_name, email_alerts")
    .eq("alert_frequency", "weekly")
    .eq("email_alerts", true)
    .not("email", "is", null)

  if (!users?.length) return NextResponse.json({ sent: 0, reason: "no weekly users" })

  const { data: recentJobs } = await supabase
    .from("jobs")
    .select("*, company:companies(name)")
    .eq("is_active", true)
    .gte("first_detected_at", since)
    .order("first_detected_at", { ascending: false })

  if (!recentJobs?.length) return NextResponse.json({ sent: 0, reason: "no new jobs this week" })

  type JobWithCompanyName = Job & { company: { name: string } | null; company_name: string }
  const flatJobs = (recentJobs as unknown as Array<Job & { company: { name: string } | null }>).map(
    (j): JobWithCompanyName => ({ ...j, company_name: j.company?.name ?? "" })
  )

  let sent = 0
  let errors = 0

  for (const user of users) {
    const { data: alerts } = await supabase
      .from("job_alerts")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true)

    if (!alerts?.length) continue

    const sections: Array<{ alertName: string; jobs: typeof flatJobs }> = []
    let totalCount = 0

    for (const alert of alerts) {
      const matched = flatJobs.filter((job) => matchesAlert(alert, job)).slice(0, 10)
      if (!matched.length) continue
      sections.push({ alertName: alert.name ?? "Untitled alert", jobs: matched })
      totalCount += matched.length
    }

    if (!sections.length) continue

    try {
      await resend.emails.send({
        from: getAlertsFromEmail(),
        to: user.email!,
        subject: `Your weekly job digest — ${totalCount} new match${totalCount === 1 ? "" : "es"} this week`,
        html: buildWeeklyEmail(user, sections, totalCount, platformStats),
      })
      sent++
    } catch {
      errors++
    }
  }

  return NextResponse.json({ sent, errors, window: "7d" })
}
