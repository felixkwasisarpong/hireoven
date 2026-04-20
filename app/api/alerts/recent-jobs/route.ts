import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { getRecentJobsFromEmail } from "@/lib/email/identity"
import { requireCronAuth } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

type UserProfile = {
  id: string
  email: string | null
  full_name: string | null
  email_alerts: boolean
}

type MatchedJobRow = {
  user_id: string
  overall_score: number
  jobs: {
    id: string
    title: string
    apply_url: string
    location: string | null
    is_remote: boolean
    first_detected_at: string
    company: { name: string } | null
  } | null
}

type FallbackJob = {
  id: string
  title: string
  apply_url: string
  location: string | null
  is_remote: boolean
  first_detected_at: string
  company: { name: string } | null
}

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatFreshness(timestamp: string) {
  const diffMinutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
  )

  if (diffMinutes < 60) return `${diffMinutes} min ago`
  const hours = Math.floor(diffMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatLocation(location: string | null, isRemote: boolean) {
  if (isRemote && location) return `${location} · Remote`
  if (isRemote) return "Remote"
  return location ?? "Location not listed"
}

function renderJobRows(
  jobs: Array<{
    id: string
    title: string
    apply_url: string
    location: string | null
    is_remote: boolean
    first_detected_at: string
    company: { name: string } | null
    score?: number
  }>
) {
  return jobs
    .map((job) => {
      const scoreBadge =
        typeof job.score === "number"
          ? `<span style="display:inline-block;margin-top:8px;padding:4px 8px;border-radius:999px;border:1px solid #bae6fd;background:#f0f9ff;color:#0369a1;font-size:11px;font-weight:700;">${job.score}% match</span>`
          : ""

      return `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #eef2f7;">
          <a href="${htmlEscape(job.apply_url)}" style="font-size:16px;font-weight:700;color:#0369A1;text-decoration:none;">
            ${htmlEscape(job.title)}
          </a>
          <div style="font-size:13px;color:#64748b;margin-top:4px;">
            ${htmlEscape(job.company?.name ?? "Hireoven company")} · ${htmlEscape(formatLocation(job.location, job.is_remote))}
          </div>
          <div style="font-size:12px;color:#94a3b8;margin-top:6px;">
            Posted ${htmlEscape(formatFreshness(job.first_detected_at))}
          </div>
          ${scoreBadge}
        </td>
      </tr>
      `
    })
    .join("")
}

function buildEmail({
  firstName,
  title,
  subtitle,
  jobsTableRows,
  ctaLabel,
}: {
  firstName: string
  title: string
  subtitle: string
  jobsTableRows: string
  ctaLabel: string
}) {
  const baseUrl = getBaseUrl()

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f9ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f5f9ff;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #dbeafe;border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:28px 30px;background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 100%);">
            <div style="font-size:12px;font-weight:700;color:#dbeafe;letter-spacing:0.12em;text-transform:uppercase;">Hireoven</div>
            <div style="margin-top:12px;font-size:28px;line-height:1.2;font-weight:800;color:#ffffff;">${htmlEscape(title)}</div>
            <div style="margin-top:10px;font-size:15px;line-height:1.5;color:#e0f2fe;">${htmlEscape(subtitle)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 30px;">
            <p style="margin:0 0 18px;font-size:15px;color:#334155;">Hi ${htmlEscape(firstName)},</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${jobsTableRows}
            </table>
            <div style="margin-top:26px;text-align:center;">
              <a href="${baseUrl}/dashboard/matches" style="display:inline-block;background:#0369A1;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:700;">
                ${htmlEscape(ctaLabel)}
              </a>
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 30px;background:#f8fafc;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
              You're receiving recent jobs updates from Hireoven.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function getSegment(searchParams: URLSearchParams) {
  const segment = searchParams.get("segment")
  if (segment === "with-resume" || segment === "without-resume" || segment === "all") {
    return segment
  }
  return "all"
}

function firstNameOf(fullName: string | null) {
  return fullName?.trim().split(/\s+/)[0] || "there"
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!resend) {
    return NextResponse.json({ skipped: true, reason: "RESEND_API_KEY not configured" })
  }

  const segment = getSegment(request.nextUrl.searchParams)
  const withResumeWindowHours = Number(request.nextUrl.searchParams.get("withResumeHours") ?? "6")
  const withResumeSince = new Date(
    Date.now() - Math.max(1, withResumeWindowHours) * 3_600_000
  ).toISOString()
  const endOfDaySince = new Date(Date.now() - 24 * 3_600_000).toISOString()

  const supabase = createAdminClient()
  const { data: usersRaw, error: usersError } = await supabase
    .from("profiles")
    .select("id, email, full_name, email_alerts")
    .eq("email_alerts", true)
    .not("email", "is", null)

  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 })
  }

  const users = (usersRaw ?? []) as UserProfile[]
  if (!users.length) return NextResponse.json({ sent: 0, skipped: "No eligible users" })

  const userIds = users.map((user) => user.id)
  const { data: resumeRows, error: resumeError } = await supabase
    .from("resumes")
    .select("user_id")
    .in("user_id", userIds)

  if (resumeError) {
    return NextResponse.json({ error: resumeError.message }, { status: 500 })
  }

  const usersWithResume = new Set(
    ((resumeRows ?? []) as Array<{ user_id: string | null }>)
      .map((row) => row.user_id)
      .filter((value): value is string => Boolean(value))
  )

  const resumeRecipients =
    segment === "without-resume"
      ? []
      : users.filter((user) => usersWithResume.has(user.id))
  const noResumeRecipients =
    segment === "with-resume"
      ? []
      : users.filter((user) => !usersWithResume.has(user.id))

  let sentWithResume = 0
  let sentWithoutResume = 0
  let errors = 0

  if (resumeRecipients.length) {
    const { data: matchedRowsRaw, error: matchedError } = await supabase
      .from("job_match_scores")
      .select(
        "user_id, overall_score, jobs!inner(id, title, apply_url, location, is_remote, first_detected_at, company:companies(name))"
      )
      .in("user_id", resumeRecipients.map((user) => user.id))
      .gte("overall_score", 75)
      .gte("jobs.first_detected_at", withResumeSince)
      .eq("jobs.is_active", true)
      .order("overall_score", { ascending: false })
      .order("first_detected_at", { foreignTable: "jobs", ascending: false })
      .limit(1000)

    if (matchedError) {
      return NextResponse.json({ error: matchedError.message }, { status: 500 })
    }

    const byUser = new Map<string, Array<MatchedJobRow>>()
    for (const row of (matchedRowsRaw ?? []) as unknown as MatchedJobRow[]) {
      const current = byUser.get(row.user_id) ?? []
      current.push(row)
      byUser.set(row.user_id, current)
    }

    for (const user of resumeRecipients) {
      const rows = byUser.get(user.id) ?? []
      if (!rows.length) continue

      const topJobs = rows
        .filter((row) => row.jobs)
        .slice(0, 5)
        .map((row) => ({
          ...row.jobs!,
          score: row.overall_score,
        }))

      if (!topJobs.length) continue

      try {
        await resend.emails.send({
          from: getRecentJobsFromEmail(),
          to: [user.email!],
          subject: `${topJobs.length} high-match jobs just added for you`,
          html: buildEmail({
            firstName: firstNameOf(user.full_name),
            title: "Fresh high-match jobs",
            subtitle: "These new roles are 75%+ matches for your resume.",
            jobsTableRows: renderJobRows(topJobs),
            ctaLabel: "View more high-match jobs",
          }),
        })
        sentWithResume += 1
      } catch {
        errors += 1
      }
    }
  }

  if (noResumeRecipients.length) {
    const { data: fallbackJobsRaw, error: fallbackError } = await supabase
      .from("jobs")
      .select("id, title, apply_url, location, is_remote, first_detected_at, company:companies(name)")
      .eq("is_active", true)
      .gte("first_detected_at", endOfDaySince)
      .order("first_detected_at", { ascending: false })
      .limit(5)

    if (fallbackError) {
      return NextResponse.json({ error: fallbackError.message }, { status: 500 })
    }

    const fallbackJobs = (fallbackJobsRaw ?? []) as unknown as FallbackJob[]
    if (fallbackJobs.length) {
      for (const user of noResumeRecipients) {
        try {
          await resend.emails.send({
            from: getRecentJobsFromEmail(),
            to: [user.email!],
            subject: `Today's 5 fresh jobs on Hireoven`,
            html: buildEmail({
              firstName: firstNameOf(user.full_name),
              title: "Today's fresh jobs",
              subtitle:
                "We picked recent openings for you. Upload your resume to unlock personalized 75%+ match emails.",
              jobsTableRows: renderJobRows(fallbackJobs),
              ctaLabel: "Upload resume and personalize",
            }),
          })
          sentWithoutResume += 1
        } catch {
          errors += 1
        }
      }
    }
  }

  return NextResponse.json({
    segment,
    sentWithResume,
    sentWithoutResume,
    errors,
    withResumeWindowHours,
  })
}
