import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { getRecentJobsFromEmail } from "@/lib/email/identity"
import { requireCronAuth } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"

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

  const pool = getPostgresPool()
  const usersResult = await pool.query<UserProfile>(
    `SELECT id, email, full_name, email_alerts
     FROM profiles
     WHERE email_alerts = true
       AND email IS NOT NULL`
  )
  const users = usersResult.rows
  if (!users.length) return NextResponse.json({ sent: 0, skipped: "No eligible users" })

  const userIds = users.map((user) => user.id)
  const resumeRowsResult = await pool.query<{ user_id: string | null }>(
    `SELECT DISTINCT user_id
     FROM resumes
     WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  )

  const usersWithResume = new Set(
    (resumeRowsResult.rows as Array<{ user_id: string | null }>)
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
    const matchedRowsResult = await pool.query<
      {
        user_id: string
        overall_score: number
        id: string
        title: string
        apply_url: string
        location: string | null
        is_remote: boolean
        first_detected_at: string
        company_name: string | null
      }
    >(
      `SELECT
         jms.user_id,
         jms.overall_score,
         jobs.id,
         jobs.title,
         jobs.apply_url,
         jobs.location,
         jobs.is_remote,
         jobs.first_detected_at,
         companies.name AS company_name
       FROM job_match_scores jms
       INNER JOIN jobs ON jobs.id = jms.job_id
       LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE jms.user_id = ANY($1::uuid[])
         AND jms.overall_score >= 75
         AND jobs.first_detected_at >= $2
         AND jobs.is_active = true
       ORDER BY jms.overall_score DESC, jobs.first_detected_at DESC
       LIMIT 1000`,
      [resumeRecipients.map((user) => user.id), withResumeSince]
    )

    const byUser = new Map<string, Array<MatchedJobRow>>()
    for (const row of matchedRowsResult.rows) {
      const normalized: MatchedJobRow = {
        user_id: row.user_id,
        overall_score: row.overall_score,
        jobs: {
          id: row.id,
          title: row.title,
          apply_url: row.apply_url,
          location: row.location,
          is_remote: row.is_remote,
          first_detected_at: row.first_detected_at,
          company: row.company_name ? { name: row.company_name } : null,
        },
      }
      const current = byUser.get(row.user_id) ?? []
      current.push(normalized)
      byUser.set(normalized.user_id, current)
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
    const fallbackJobsResult = await pool.query<
      {
        id: string
        title: string
        apply_url: string
        location: string | null
        is_remote: boolean
        first_detected_at: string
        company_name: string | null
      }
    >(
      `SELECT
         jobs.id,
         jobs.title,
         jobs.apply_url,
         jobs.location,
         jobs.is_remote,
         jobs.first_detected_at,
         companies.name AS company_name
       FROM jobs
       LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE jobs.is_active = true
         AND jobs.first_detected_at >= $1
       ORDER BY jobs.first_detected_at DESC
       LIMIT 5`,
      [endOfDaySince]
    )

    const fallbackJobs = fallbackJobsResult.rows.map<FallbackJob>((row) => ({
      id: row.id,
      title: row.title,
      apply_url: row.apply_url,
      location: row.location,
      is_remote: row.is_remote,
      first_detected_at: row.first_detected_at,
      company: row.company_name ? { name: row.company_name } : null,
    }))
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
