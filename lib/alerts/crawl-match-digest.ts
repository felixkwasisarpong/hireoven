import { Resend } from "resend"
import { logApiUsage } from "@/lib/admin/usage"
import { getAlertsFromEmail } from "@/lib/email/identity"
import { getPostgresPool } from "@/lib/postgres/server"

type DigestQueryRow = {
  user_id: string
  email: string
  full_name: string | null
  job_id: string
  title: string
  apply_url: string
  location: string | null
  is_remote: boolean
  is_hybrid: boolean
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  first_detected_at: string
  overall_score: number
  company_name: string | null
  company_domain: string | null
  sponsors_h1b: boolean | null
  sponsorship_score: number | null
  requires_authorization: boolean
  rank: number
}

type UserDigestPayload = {
  userId: string
  email: string
  fullName: string | null
  jobs: DigestQueryRow[]
}

export type CrawlTopMatchDigestSummary = {
  enabled: boolean
  windowStartIso: string
  windowEndIso: string
  minScore: number
  maxJobsPerUser: number
  jobsInsertedInWindow: number
  matchedUsers: number
  emailsSent: number
  emailsFailed: number
  skippedReason?: string
}

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
}

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatLocation(row: DigestQueryRow) {
  if (row.is_remote && row.location) return `${row.location} · Remote`
  if (row.is_remote) return "Remote"
  if (row.is_hybrid && row.location) return `${row.location} · Hybrid`
  if (row.is_hybrid) return "Hybrid"
  return row.location ?? "Location not listed"
}

function formatFreshness(timestamp: string) {
  const diffMins = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000))
  if (diffMins < 60) return `${diffMins}m ago`
  const diffH = Math.floor(diffMins / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

function formatSalary(row: DigestQueryRow) {
  const currency = (row.salary_currency ?? "USD").toUpperCase()
  if (row.salary_min != null && row.salary_max != null) {
    return `${currency} ${Math.round(row.salary_min / 1000)}k – ${Math.round(row.salary_max / 1000)}k`
  }
  if (row.salary_min != null) return `${currency} ${Math.round(row.salary_min / 1000)}k+`
  return null
}

function logoProxyUrl(domain: string | null | undefined): string | null {
  if (!domain) return null
  return `${getBaseUrl()}/api/logo?domain=${encodeURIComponent(domain.trim().toLowerCase())}`
}

function scoreColor(score: number): { bg: string; border: string; text: string } {
  if (score >= 90) return { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d" }
  if (score >= 80) return { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" }
  return { bg: "#fff7ed", border: "#fed7aa", text: "#9a3412" }
}

function renderJobRow(row: DigestQueryRow, index: number) {
  const company = row.company_name ?? "Tracked company"
  const proxyUrl = logoProxyUrl(row.company_domain)
  const salary = formatSalary(row)
  const score = Math.round(row.overall_score)
  const sc = scoreColor(score)

  const logoHtml = proxyUrl
    ? `<img src="${esc(proxyUrl)}" alt="${esc(company)}" width="48" height="48"
          style="width:48px;height:48px;border-radius:8px;object-fit:contain;border:1px solid #e2e8f0;background:#fff;display:block;" />`
    : `<div style="width:48px;height:48px;border-radius:8px;background:linear-gradient(135deg,#FF5C18,#FF9A3C);font-size:20px;font-weight:800;color:#fff;text-align:center;line-height:48px;">${esc(company.charAt(0).toUpperCase())}</div>`

  let sponsorBadge = ""
  if (row.sponsors_h1b)
    sponsorBadge = `<span style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">✓ H1B sponsor</span>`
  else if (row.requires_authorization)
    sponsorBadge = `<span style="display:inline-block;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">No sponsorship</span>`
  else if ((row.sponsorship_score ?? 0) > 60)
    sponsorBadge = `<span style="display:inline-block;background:#faf5ff;border:1px solid #e9d5ff;color:#7c3aed;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">Likely sponsors</span>`

  const scoreBadge = `<span style="display:inline-block;background:${sc.bg};border:1px solid ${sc.border};color:${sc.text};border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${score}% match</span>`
  const badges = [scoreBadge, sponsorBadge].filter(Boolean).join("&nbsp;")

  const jobUrl = `${getBaseUrl()}/dashboard/jobs/${esc(row.job_id)}`
  const divider = index > 0
    ? `<tr><td colspan="2" style="padding:0 0 16px;"><div style="height:1px;background:#f1f5f9;"></div></td></tr>`
    : ""

  return `
    ${divider}
    <tr>
      <td style="vertical-align:top;padding-right:14px;width:62px;padding-bottom:20px;">${logoHtml}</td>
      <td style="vertical-align:top;padding-bottom:20px;">
        <div style="font-size:15px;font-weight:700;color:#0f172a;line-height:1.3;margin-bottom:3px;">
          <a href="${jobUrl}" style="color:#0f172a;text-decoration:none;">${esc(row.title)}</a>
        </div>
        <div style="font-size:13px;color:#475569;margin-bottom:2px;">${esc(company)}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">
          ${esc(formatLocation(row))}&nbsp;·&nbsp;${formatFreshness(row.first_detected_at)}${salary ? `&nbsp;·&nbsp;${esc(salary)}` : ""}
        </div>
        ${badges ? `<div>${badges}</div>` : ""}
      </td>
    </tr>
  `
}

function renderDigestHtml(args: {
  firstName: string
  jobs: DigestQueryRow[]
  minScore: number
}) {
  const base = getBaseUrl()
  const count = args.jobs.length
  const year = new Date().getFullYear()
  const jobRowsHtml = args.jobs.map((row, i) => renderJobRow(row, i)).join("")

  const headerTitle = count === 1
    ? `1 new match for you`
    : `${count} new matches for you`

  const topCompanies = [...new Set(args.jobs.slice(0, 2).map(j => j.company_name).filter(Boolean))]
  const headerSub = topCompanies.length > 0
    ? `High-fit roles from ${topCompanies.join(", ")}${count > topCompanies.length ? ` and ${count - topCompanies.length} more` : ""}.`
    : `Fresh roles that align with your resume and profile.`

  const preheader = topCompanies.length > 0
    ? `${headerTitle} — ${topCompanies.join(", ")}${count > 2 ? ` +${count - 2} more` : ""}`
    : headerTitle

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f2ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f3f2ef;">${esc(preheader)}</div>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ef;padding:24px 16px 0;">
    <tr><td align="center">
      <table width="100%" style="max-width:584px;" cellpadding="0" cellspacing="0">

        <!-- Wordmark -->
        <tr><td style="padding:0 0 16px;">
          <span style="font-size:20px;font-weight:900;letter-spacing:-0.5px;">
            <span style="color:#FF5C18;">Hire</span><span style="color:#0f172a;">oven</span>
          </span>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">

          <!-- Header -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;">
              <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.2;margin-bottom:4px;">${esc(headerTitle)}</div>
              <div style="font-size:14px;color:#64748b;line-height:1.5;">
                Hi ${esc(args.firstName)} — ${esc(headerSub)}
              </div>
            </td></tr>
          </table>

          <!-- Jobs -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:20px 24px 4px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${jobRowsHtml}
              </table>
            </td></tr>
          </table>

          <!-- CTA -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:4px 24px 24px;">
              <a href="${esc(base)}/dashboard?sort=match"
                 style="display:inline-block;border:1.5px solid #FF5C18;color:#FF5C18;text-decoration:none;padding:10px 24px;border-radius:999px;font-size:14px;font-weight:700;">
                See all your matches
              </a>
            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 4px 32px;">
          <div style="font-size:12px;color:#64748b;line-height:1.7;">
            You're receiving this because new jobs matching your profile were found.<br>
            <a href="${esc(base)}/dashboard/alerts" style="color:#64748b;text-decoration:underline;">Manage alerts</a>
            &nbsp;·&nbsp;
            <a href="${esc(base)}/dashboard/onboarding" style="color:#64748b;text-decoration:underline;">Update preferences</a>
          </div>
          <div style="margin-top:12px;">
            <span style="font-size:14px;font-weight:900;letter-spacing:-0.3px;">
              <span style="color:#FF5C18;">Hire</span><span style="color:#0f172a;">oven</span>
            </span>
          </div>
          <div style="font-size:11px;color:#94a3b8;margin-top:6px;">
            &copy; ${year} Hireoven. Jobs served fresh.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`
}

function buildSubjectLine(firstName: string, jobs: DigestQueryRow[]): string {
  const count = jobs.length
  const topCompanies = [...new Set(jobs.slice(0, 2).map(j => j.company_name).filter(Boolean))]

  if (topCompanies.length === 0) {
    return count === 1
      ? `${firstName}, 1 new match just landed`
      : `${firstName}, ${count} new matches just landed`
  }

  const companyStr = topCompanies.length === 1
    ? topCompanies[0]!
    : `${topCompanies[0]} and ${topCompanies[1]}`

  return count === 1
    ? `New match at ${companyStr}`
    : `${count} new matches — ${companyStr}${count > 2 ? ` +${count - 2} more` : ""}`
}

async function fetchDigestRows(params: {
  windowStartIso: string
  windowEndIso: string
  minScore: number
  maxJobsPerUser: number
}) {
  const pool = getPostgresPool()
  const result = await pool.query<DigestQueryRow>(
    `WITH crawl_window_jobs AS (
       SELECT id
       FROM jobs
       WHERE created_at >= $1::timestamptz
         AND created_at <= $2::timestamptz
         AND is_active = true
     ),
     best_scores AS (
       SELECT DISTINCT ON (s.user_id, s.job_id)
         s.user_id,
         s.job_id,
         s.overall_score,
         s.computed_at
       FROM job_match_scores s
       JOIN resumes r ON r.id = s.resume_id
       JOIN crawl_window_jobs cw ON cw.id = s.job_id
       WHERE s.overall_score >= $3
         AND r.user_id = s.user_id
         AND r.is_primary = true
         AND r.parse_status = 'complete'
       ORDER BY s.user_id, s.job_id, s.overall_score DESC, s.computed_at DESC
     ),
     ranked AS (
       SELECT
         p.id AS user_id,
         p.email,
         p.full_name,
         j.id AS job_id,
         j.title,
         j.apply_url,
         j.location,
         j.is_remote,
         j.is_hybrid,
         j.salary_min,
         j.salary_max,
         j.salary_currency,
         j.first_detected_at,
         b.overall_score,
         c.name AS company_name,
         c.domain AS company_domain,
         j.sponsors_h1b,
         j.sponsorship_score,
         j.requires_authorization,
         ROW_NUMBER() OVER (
           PARTITION BY p.id
           ORDER BY b.overall_score DESC, j.created_at DESC, j.id
         ) AS rank
       FROM best_scores b
       JOIN profiles p ON p.id = b.user_id
       JOIN jobs j ON j.id = b.job_id
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE p.email IS NOT NULL
         AND p.email_alerts = true
     )
     SELECT *
     FROM ranked
     WHERE rank <= $4
     ORDER BY user_id, rank`,
    [params.windowStartIso, params.windowEndIso, params.minScore, params.maxJobsPerUser]
  )

  return result.rows
}

function groupRowsByUser(rows: DigestQueryRow[]) {
  const byUser = new Map<string, UserDigestPayload>()
  for (const row of rows) {
    const existing = byUser.get(row.user_id)
    if (existing) { existing.jobs.push(row); continue }
    byUser.set(row.user_id, {
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      jobs: [row],
    })
  }
  return [...byUser.values()]
}

async function countInsertedJobs(windowStartIso: string, windowEndIso: string) {
  const pool = getPostgresPool()
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM jobs
     WHERE created_at >= $1::timestamptz AND created_at <= $2::timestamptz`,
    [windowStartIso, windowEndIso]
  )
  return Number(result.rows[0]?.count ?? 0)
}

export async function sendCrawlTopMatchDigests(params: {
  windowStartIso: string
  windowEndIso: string
  minScore?: number
  maxJobsPerUser?: number
}): Promise<CrawlTopMatchDigestSummary> {
  const minScore = Math.max(1, Math.min(100, params.minScore ?? 80))
  const maxJobsPerUser = Math.max(1, Math.min(10, params.maxJobsPerUser ?? 5))

  if (!resend) {
    return {
      enabled: false,
      windowStartIso: params.windowStartIso,
      windowEndIso: params.windowEndIso,
      minScore,
      maxJobsPerUser,
      jobsInsertedInWindow: 0,
      matchedUsers: 0,
      emailsSent: 0,
      emailsFailed: 0,
      skippedReason: "RESEND_API_KEY not configured",
    }
  }

  const [jobsInsertedInWindow, rows] = await Promise.all([
    countInsertedJobs(params.windowStartIso, params.windowEndIso),
    fetchDigestRows({ windowStartIso: params.windowStartIso, windowEndIso: params.windowEndIso, minScore, maxJobsPerUser }),
  ])

  if (rows.length === 0) {
    return {
      enabled: true,
      windowStartIso: params.windowStartIso,
      windowEndIso: params.windowEndIso,
      minScore,
      maxJobsPerUser,
      jobsInsertedInWindow,
      matchedUsers: 0,
      emailsSent: 0,
      emailsFailed: 0,
      skippedReason: "No users with crawl-window matches at or above threshold",
    }
  }

  const users = groupRowsByUser(rows)
  let emailsSent = 0
  let emailsFailed = 0

  for (const user of users) {
    const firstName = user.fullName?.split(" ")[0]?.trim() || "there"
    const subject = buildSubjectLine(firstName, user.jobs)
    const html = renderDigestHtml({ firstName, jobs: user.jobs, minScore })

    const { error } = await resend.emails.send({
      from: getAlertsFromEmail(),
      to: [user.email],
      subject,
      html,
    })

    if (error) {
      emailsFailed += 1
      console.error(`[crawl-match-digest] email failed for user ${user.userId}: ${error.message}`)
      continue
    }

    emailsSent += 1
    await logApiUsage({ service: "resend", operation: "crawl-top-match-digest", tokens_used: null, cost_usd: 0 })
  }

  return {
    enabled: true,
    windowStartIso: params.windowStartIso,
    windowEndIso: params.windowEndIso,
    minScore,
    maxJobsPerUser,
    jobsInsertedInWindow,
    matchedUsers: users.length,
    emailsSent,
    emailsFailed,
  }
}
