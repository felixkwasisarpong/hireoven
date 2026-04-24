import webpush from "web-push"
import { Resend } from "resend"
import { logApiUsage } from "@/lib/admin/usage"
import { removeSubscription, getUserSubscriptions } from "@/lib/alerts/push-subscriptions"
import { getAlertsFromEmail } from "@/lib/email/identity"
import { env } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Company, Job, NotificationChannel, Profile } from "@/types"

type JobWithCompanyContext = Job & {
  company: Pick<Company, "id" | "name" | "logo_url" | "sponsors_h1b"> | null
}

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = env.VAPID_EMAIL

  if (!publicKey || !privateKey || !email) {
    throw new Error("Missing VAPID environment variables")
  }

  webpush.setVapidDetails(email, publicKey, privateKey)
}

async function getProfileForNotifications(userId: string) {
  const pool = getPostgresPool()
  const result = await pool.query<Pick<Profile, "id" | "email" | "full_name">>(
    `SELECT id, email, full_name
     FROM profiles
     WHERE id = $1
     LIMIT 1`,
    [userId]
  )
  const data = result.rows[0]
  if (!data) throw new Error(`Profile not found for user ${userId}`)
  return data
}

async function hydrateJobs(jobs: Job[]): Promise<JobWithCompanyContext[]> {
  const companyIds = Array.from(new Set(jobs.map((job) => job.company_id)))
  const pool = getPostgresPool()
  const result = await pool.query<Pick<Company, "id" | "name" | "logo_url" | "sponsors_h1b">>(
    `SELECT id, name, logo_url, sponsors_h1b
     FROM companies
     WHERE id = ANY($1::uuid[])`,
    [companyIds]
  )
  const data = result.rows

  const companyMap = new Map(
    ((data ?? []) as Array<Pick<Company, "id" | "name" | "logo_url" | "sponsors_h1b">>).map(
      (company) => [company.id, company]
    )
  )

  return jobs.map((job) => ({
    ...job,
    company: companyMap.get(job.company_id) ?? null,
  }))
}

function escapeHtml(value: string) {
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

  if (diffMinutes < 60) {
    return `Posted ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `Posted ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `Posted ${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}

function getLocationLabel(job: JobWithCompanyContext) {
  if (job.is_remote && job.location) return `${job.location} · Remote`
  if (job.is_remote) return "Remote"
  return job.location ?? "Location not listed"
}

function getSponsorshipBadge(job: Job) {
  if (job.sponsors_h1b) {
    return {
      label: "Sponsors H1B",
      styles:
        "display:inline-block;border:1px solid #99f6e4;background:#f0fdfa;color:#0f766e;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:600;",
    }
  }

  if (job.requires_authorization) {
    return {
      label: "No sponsorship",
      styles:
        "display:inline-block;border:1px solid #fecaca;background:#fef2f2;color:#b91c1c;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:600;",
    }
  }

  if ((job.sponsorship_score ?? 0) > 60) {
    return {
      label: "Likely sponsors",
      styles:
        "display:inline-block;border:1px solid #fde68a;background:#fffbeb;color:#b45309;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:600;",
    }
  }

  return null
}

function renderJobCard(job: JobWithCompanyContext) {
  const companyName = job.company?.name ?? "Tracked company"
  const companyInitial = companyName.charAt(0).toUpperCase()
  const sponsorshipBadge = getSponsorshipBadge(job)

  return `
    <div style="border:1px solid #dbe5e1;border-radius:20px;padding:20px;margin-bottom:16px;background:#ffffff;">
      <div style="display:flex;align-items:flex-start;gap:16px;">
        <div style="width:40px;height:40px;border-radius:999px;background:#0369A1;color:#ffffff;font-size:18px;font-weight:700;line-height:40px;text-align:center;flex-shrink:0;">
          ${escapeHtml(companyInitial)}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;font-weight:600;">
            ${escapeHtml(companyName)}
          </div>
          <div style="font-size:20px;line-height:1.35;font-weight:700;color:#111827;margin-top:4px;">
            ${escapeHtml(job.title)}
          </div>
          <div style="font-size:14px;color:#4b5563;margin-top:10px;">
            ${escapeHtml(getLocationLabel(job))}
          </div>
          <div style="font-size:14px;color:#0C4A6E;font-weight:600;margin-top:10px;">
            ${escapeHtml(formatFreshness(job.first_detected_at))}
          </div>
          ${
            sponsorshipBadge
              ? `<div style="margin-top:12px;"><span style="${sponsorshipBadge.styles}">${escapeHtml(
                  sponsorshipBadge.label
                )}</span></div>`
              : ""
          }
          <div style="margin-top:16px;">
            <a href="${escapeHtml(job.apply_url)}" style="display:inline-block;background:#0369A1;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:700;">
              Apply now
            </a>
          </div>
        </div>
      </div>
    </div>
  `
}

function renderEmailShell({
  preheader,
  title,
  subtitle,
  body,
  footer,
}: {
  preheader: string
  title: string
  subtitle: string
  body: string
  footer: string
}) {
  return `
    <!doctype html>
    <html>
      <body style="margin:0;padding:24px;background:#f3f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
        <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe5e1;border-radius:28px;overflow:hidden;">
          <div style="padding:28px 28px 20px;background:linear-gradient(180deg,#f1fcf7 0%,#ffffff 100%);border-bottom:1px solid #e5efeb;">
            <div style="font-size:14px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#0369A1;">
              Hireoven
            </div>
            <div style="font-size:28px;line-height:1.2;font-weight:800;color:#111827;margin-top:14px;">
              ${escapeHtml(title)}
            </div>
            <div style="font-size:15px;line-height:1.6;color:#4b5563;margin-top:10px;">
              ${escapeHtml(subtitle)}
            </div>
          </div>
          <div style="padding:28px;">
            ${body}
          </div>
          <div style="padding:0 28px 28px;font-size:13px;line-height:1.6;color:#6b7280;">
            ${footer}
          </div>
        </div>
      </body>
    </html>
  `
}

function buildAlertDashboardUrl(alertName: string) {
  const url = new URL("/dashboard", getBaseUrl())
  url.searchParams.set("alert", alertName)
  return url.toString()
}

function buildManageAlertsUrl() {
  return new URL("/dashboard/alerts", getBaseUrl()).toString()
}

export async function hasReachedEmailRateLimit(userId: string): Promise<boolean> {
  const pool = getPostgresPool()
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()

  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM alert_notifications
     WHERE user_id = $1
       AND sent_at >= $2
       AND channel IN ('email', 'both')`,
    [userId, oneHourAgo]
  )
  return Number(result.rows[0]?.count ?? 0) >= 10
}

export async function sendEmailAlert(
  userId: string,
  jobs: Job[],
  alertName: string
): Promise<void> {
  if (!resend) {
    throw new Error("Missing RESEND_API_KEY")
  }

  const [profile, hydratedJobs] = await Promise.all([
    getProfileForNotifications(userId),
    hydrateJobs(jobs),
  ])

  if (!profile.email) {
    throw new Error(`User ${userId} does not have an email address`)
  }

  const visibleJobs = hydratedJobs.slice(0, 5)
  const jobsHtml = visibleJobs.map(renderJobCard).join("")
  const totalJobs = hydratedJobs.length
  const viewAllButton =
    totalJobs > 5
      ? `<div style="margin-top:8px;">
          <a href="${escapeHtml(buildAlertDashboardUrl(alertName))}" style="display:inline-block;border:1px solid #0369A1;color:#0C4A6E;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:14px;font-weight:700;">
            View all ${totalJobs} jobs
          </a>
        </div>`
      : ""

  const html = renderEmailShell({
    preheader: `${totalJobs} new job match${totalJobs === 1 ? "" : "es"} for ${alertName}`,
    title: "New jobs for you",
    subtitle: `${totalJobs} new job match${totalJobs === 1 ? "" : "es"} your alert "${alertName}".`,
    body: `${jobsHtml}${viewAllButton}`,
    footer: `You're receiving this because of your alert "${escapeHtml(
      alertName
    )}". <a href="${escapeHtml(
      buildManageAlertsUrl()
    )}" style="color:#0C4A6E;">Manage alerts.</a>`,
  })

  const { error } = await resend.emails.send({
    from: getAlertsFromEmail(),
    to: [profile.email],
    subject: `${totalJobs} new job${totalJobs === 1 ? "" : "s"} match your alert: ${alertName}`,
    html,
  })

  if (error) throw new Error(error.message)

  await logApiUsage({
    service: "resend",
    operation: "email",
    tokens_used: null,
    cost_usd: 0,
  })
}

export async function sendWatchlistAlert(
  userId: string,
  jobs: Job[],
  companyName: string
): Promise<void> {
  if (!resend) {
    throw new Error("Missing RESEND_API_KEY")
  }

  const [profile, hydratedJobs] = await Promise.all([
    getProfileForNotifications(userId),
    hydrateJobs(jobs),
  ])

  if (!profile.email) {
    throw new Error(`User ${userId} does not have an email address`)
  }

  const visibleJobs = hydratedJobs.slice(0, 5)
  const html = renderEmailShell({
    preheader: `${companyName} just posted ${jobs.length} new job${jobs.length === 1 ? "" : "s"}`,
    title: `${companyName} is hiring`,
    subtitle: `${jobs.length} new role${jobs.length === 1 ? "" : "s"} just landed from a company on your watchlist.`,
    body: visibleJobs.map(renderJobCard).join(""),
    footer: `This update was triggered by your watchlist. <a href="${escapeHtml(
      new URL("/dashboard/watchlist", getBaseUrl()).toString()
    )}" style="color:#0C4A6E;">Manage watchlist.</a>`,
  })

  const { error } = await resend.emails.send({
    from: getAlertsFromEmail(),
    to: [profile.email],
    subject: `${companyName} just posted ${jobs.length} new job${jobs.length === 1 ? "" : "s"}`,
    html,
  })

  if (error) throw new Error(error.message)

  await logApiUsage({
    service: "resend",
    operation: "watchlist-email",
    tokens_used: null,
    cost_usd: 0,
  })
}

export async function sendPushNotification(
  userId: string,
  job: Job,
  type: "alert" | "watchlist"
): Promise<void> {
  configureWebPush()

  const [hydratedJob] = await hydrateJobs([job])
  const subscriptions = await getUserSubscriptions(userId)

  if (!subscriptions.length) {
    throw new Error(`No push subscriptions for user ${userId}`)
  }

  const companyName = hydratedJob.company?.name ?? "Tracked company"
  const payload = JSON.stringify({
    title: type === "watchlist" ? `${companyName} is hiring` : `New job match: ${job.title}`,
    body: `${companyName} · ${getLocationLabel(hydratedJob)} · Posted just now`,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data: {
      jobId: job.id,
      applyUrl: job.apply_url,
    },
    actions: [
      { action: "apply", title: "Apply now" },
      { action: "dismiss", title: "Dismiss" },
    ],
  })

  let successCount = 0

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload)
      successCount += 1
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode
      if (statusCode === 404 || statusCode === 410) {
        await removeSubscription(subscription.endpoint)
        continue
      }

      throw error
    }
  }

  if (successCount === 0) {
    throw new Error(`Unable to deliver push notification to user ${userId}`)
  }

  await logApiUsage({
    service: "webpush",
    operation: type,
    tokens_used: null,
    cost_usd: 0,
  })
}

export function combineChannels({
  emailSent,
  pushSent,
}: {
  emailSent: boolean
  pushSent: boolean
}): NotificationChannel | null {
  if (emailSent && pushSent) return "both"
  if (emailSent) return "email"
  if (pushSent) return "push"
  return null
}
