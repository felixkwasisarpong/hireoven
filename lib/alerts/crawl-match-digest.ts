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
const HERO_GIF_URL =
  process.env.CRAWL_MATCH_DIGEST_GIF_URL ??
  "https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3A2M3Fua2Myam1pNWJoN3N2OHQ2M2p6bnV1eWc5aXk5OW9jaW1xbyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/26ufdipQqU2lhNA4g/giphy.gif"

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
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
  const diffMinutes = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000))
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

function formatSalary(row: DigestQueryRow) {
  const currency = (row.salary_currency ?? "USD").toUpperCase()
  if (row.salary_min != null && row.salary_max != null) {
    return `${currency} ${Math.round(row.salary_min / 1000)}k - ${Math.round(row.salary_max / 1000)}k`
  }
  if (row.salary_min != null) {
    return `${currency} ${Math.round(row.salary_min / 1000)}k+`
  }
  return null
}

function sponsorshipLabel(row: DigestQueryRow) {
  if (row.sponsors_h1b === true || (row.sponsorship_score ?? 0) >= 70) {
    return "H1B likely"
  }
  if (row.requires_authorization) {
    return "No sponsorship"
  }
  return "Visa signal mixed"
}

function sponsorshipStyles(row: DigestQueryRow) {
  if (row.sponsors_h1b === true || (row.sponsorship_score ?? 0) >= 70) {
    return "display:inline-block;border:1px solid #86efac;background:#f0fdf4;color:#166534;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;"
  }
  if (row.requires_authorization) {
    return "display:inline-block;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;"
  }
  return "display:inline-block;border:1px solid #fed7aa;background:#fff7ed;color:#9a3412;border-radius:999px;padding:5px 10px;font-size:11px;font-weight:700;"
}

function scoreStyles(score: number) {
  if (score >= 90) {
    return "display:inline-block;border:1px solid #86efac;background:#ecfdf5;color:#166534;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:800;"
  }
  if (score >= 85) {
    return "display:inline-block;border:1px solid #7dd3fc;background:#f0f9ff;color:#075985;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:800;"
  }
  return "display:inline-block;border:1px solid #fdba74;background:#fff7ed;color:#9a3412;border-radius:999px;padding:6px 12px;font-size:12px;font-weight:800;"
}

function renderJobCard(row: DigestQueryRow) {
  const salary = formatSalary(row)
  const company = row.company_name ?? "Tracked company"

  return `
    <div style="border:1px solid #ffe7d6;border-radius:18px;padding:18px;margin-bottom:14px;background:#ffffff;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#9ca3af;">
            ${escapeHtml(company)}
          </div>
          <div style="font-size:19px;line-height:1.35;font-weight:800;color:#111827;margin-top:6px;">
            ${escapeHtml(row.title)}
          </div>
          <div style="font-size:13px;color:#475569;margin-top:10px;">
            ${escapeHtml(formatLocation(row))}
          </div>
          <div style="font-size:12px;color:#64748b;margin-top:6px;">
            Freshness: ${escapeHtml(formatFreshness(row.first_detected_at))}
            ${salary ? ` · ${escapeHtml(salary)}` : ""}
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span style="${sponsorshipStyles(row)}">${escapeHtml(sponsorshipLabel(row))}</span>
            <span style="font-size:11px;color:#94a3b8;">Rank #${row.rank}</span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <span style="${scoreStyles(row.overall_score)}">${Math.round(row.overall_score)}% match</span>
        </div>
      </div>

      <div style="margin-top:16px;">
        <a href="${escapeHtml(row.apply_url)}" style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:11px 18px;border-radius:999px;font-size:13px;font-weight:800;">
          Open role
        </a>
      </div>
    </div>
  `
}

function renderDigestHtml(args: {
  recipientName: string
  jobs: DigestQueryRow[]
  minScore: number
  jobsInsertedInWindow: number
  windowStartIso: string
  windowEndIso: string
}) {
  const base = getBaseUrl()
  const windowStart = new Date(args.windowStartIso).toLocaleDateString()
  const windowEnd = new Date(args.windowEndIso).toLocaleDateString()
  const cardsHtml = args.jobs.map(renderJobCard).join("")

  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:28px;background:#fff9f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Top ${args.jobs.length} job matches from your latest crawl.</div>
        <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #fed7aa;border-radius:26px;overflow:hidden;">
          <div style="padding:26px 28px 18px;background:linear-gradient(180deg,#fff7ed 0%,#ffffff 95%);border-bottom:1px solid #ffedd5;">
            <div style="font-size:13px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#ea580c;">Hireoven Match Drop</div>
            <div style="font-size:30px;line-height:1.15;font-weight:900;color:#111827;margin-top:12px;">
              Your Top ${args.jobs.length} Matches Are In
            </div>
            <div style="font-size:15px;line-height:1.6;color:#475569;margin-top:10px;">
              Hey ${escapeHtml(args.recipientName)} - we just finished a crawl and found high-fit roles with score <strong>${args.minScore}%+</strong>.
            </div>
          </div>

          <div style="padding:0 28px 22px;background:#ffffff;">
            <img src="${escapeHtml(HERO_GIF_URL)}" alt="New opportunities" style="display:block;width:100%;max-width:624px;height:200px;object-fit:cover;border-radius:16px;margin-top:18px;border:1px solid #ffe8d8;" />
          </div>

          <div style="padding:0 28px 10px;">
            <div style="font-size:13px;color:#64748b;margin-bottom:18px;">
              Crawl window: ${escapeHtml(windowStart)} - ${escapeHtml(windowEnd)} · New jobs indexed: ${args.jobsInsertedInWindow}
            </div>
            ${cardsHtml}
          </div>

          <div style="padding:10px 28px 30px;">
            <a href="${escapeHtml(base)}/dashboard?sort=match" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:14px;font-weight:800;">
              View all matches on Hireoven
            </a>
          </div>

          <div style="padding:0 28px 28px;font-size:12px;line-height:1.6;color:#94a3b8;">
            You’re receiving this because email alerts are enabled on your account.
            <a href="${escapeHtml(base)}/dashboard/onboarding" style="color:#ea580c;">Manage preferences</a>
          </div>
        </div>
      </body>
    </html>
  `
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
    if (existing) {
      existing.jobs.push(row)
      continue
    }
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
    `SELECT COUNT(*)::text AS count
     FROM jobs
     WHERE created_at >= $1::timestamptz
       AND created_at <= $2::timestamptz`,
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
    fetchDigestRows({
      windowStartIso: params.windowStartIso,
      windowEndIso: params.windowEndIso,
      minScore,
      maxJobsPerUser,
    }),
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
    const recipientName = user.fullName?.split(" ")[0]?.trim() || "there"
    const html = renderDigestHtml({
      recipientName,
      jobs: user.jobs,
      minScore,
      jobsInsertedInWindow,
      windowStartIso: params.windowStartIso,
      windowEndIso: params.windowEndIso,
    })

    const { error } = await resend.emails.send({
      from: getAlertsFromEmail(),
      to: [user.email],
      subject: `Top ${user.jobs.length} job matches (${minScore}%+) from the latest crawl`,
      html,
    })

    if (error) {
      emailsFailed += 1
      console.error(`[crawl-match-digest] email failed for user ${user.userId}: ${error.message}`)
      continue
    }

    emailsSent += 1
    await logApiUsage({
      service: "resend",
      operation: "crawl-top-match-digest",
      tokens_used: null,
      cost_usd: 0,
    })
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
