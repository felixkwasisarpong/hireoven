import webpush from "web-push"
import { Resend } from "resend"
import { logApiUsage } from "@/lib/admin/usage"
import { removeSubscription, getUserSubscriptions } from "@/lib/alerts/push-subscriptions"
import { getAlertsFromEmail } from "@/lib/email/identity"
import { env } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Company, Job, NotificationChannel, Profile } from "@/types"

type JobWithCompanyContext = Job & {
  company: Pick<Company, "id" | "name" | "logo_url" | "domain" | "sponsors_h1b"> | null
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
  if (!publicKey || !privateKey || !email) throw new Error("Missing VAPID environment variables")
  webpush.setVapidDetails(email, publicKey, privateKey)
}

async function getProfileForNotifications(userId: string) {
  const pool = getPostgresPool()
  const result = await pool.query<Pick<Profile, "id" | "email" | "full_name">>(
    `SELECT id, email, full_name FROM profiles WHERE id = $1 LIMIT 1`,
    [userId]
  )
  const data = result.rows[0]
  if (!data) throw new Error(`Profile not found for user ${userId}`)
  return data
}

async function hydrateJobs(jobs: Job[]): Promise<JobWithCompanyContext[]> {
  const companyIds = Array.from(new Set(jobs.map((j) => j.company_id)))
  const pool = getPostgresPool()
  const result = await pool.query<Pick<Company, "id" | "name" | "logo_url" | "domain" | "sponsors_h1b">>(
    `SELECT id, name, logo_url, domain, sponsors_h1b FROM companies WHERE id = ANY($1::uuid[])`,
    [companyIds]
  )
  const companyMap = new Map(result.rows.map((c) => [c.id, c]))
  return jobs.map((j) => ({ ...j, company: companyMap.get(j.company_id) ?? null }))
}

function esc(value: string) {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function formatFreshness(timestamp: string) {
  const mins = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function getLocationLabel(job: JobWithCompanyContext) {
  if (job.is_remote && job.location) return `${job.location} · Remote`
  if (job.is_remote) return "Remote"
  if (job.is_hybrid && job.location) return `Hybrid · ${job.location}`
  return job.location ?? "Location not listed"
}

// ── Job row (LinkedIn-style — no per-card apply button) ──────────────────────

function renderJobRow(job: JobWithCompanyContext, index: number) {
  const co = job.company
  const companyName = co?.name ?? "Tracked company"
  const logoUrl = co?.logo_url ?? null

  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" width="56" height="56"
          style="width:56px;height:56px;border-radius:10px;object-fit:contain;border:1px solid #e2e8f0;background:#fff;display:block;" />`
    : `<div style="width:56px;height:56px;border-radius:10px;background:linear-gradient(135deg,#FF5C18,#FF9A3C);font-size:22px;font-weight:800;color:#fff;text-align:center;line-height:56px;">
         ${esc(companyName.charAt(0).toUpperCase())}
       </div>`

  // Sponsorship score used as a proxy match signal when no AI score is available
  const rawScore = job.sponsorship_score ?? null
  const matchBadge = rawScore !== null && rawScore >= 70
    ? (() => {
        const s = Math.round(rawScore)
        const color = s >= 85 ? "#15803d" : "#1d4ed8"
        const bg   = s >= 85 ? "#f0fdf4" : "#eff6ff"
        const bd   = s >= 85 ? "#bbf7d0" : "#bfdbfe"
        return `<span style="display:inline-block;background:${bg};border:1px solid ${bd};color:${color};border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${s}% signal</span>`
      })()
    : ""

  // Sponsorship signal
  let sponsorBadge = ""
  if (job.sponsors_h1b)
    sponsorBadge = `<span style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">✓ H1B sponsor</span>`
  else if (job.requires_authorization)
    sponsorBadge = `<span style="display:inline-block;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">No sponsorship</span>`
  else if ((job.sponsorship_score ?? 0) > 60)
    sponsorBadge = `<span style="display:inline-block;background:#faf5ff;border:1px solid #e9d5ff;color:#7c3aed;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:600;">Likely sponsors</span>`

  const badges = [matchBadge, sponsorBadge].filter(Boolean).join("&nbsp;")

  const jobUrl = `${getBaseUrl()}/dashboard?jobId=${esc(job.id)}`
  const divider = index > 0 ? `<tr><td colspan="2" style="padding:0 0 18px;"><div style="height:1px;background:#f1f5f9;"></div></td></tr>` : ""

  return `
    ${divider}
    <tr>
      <td style="vertical-align:top;padding-right:16px;width:72px;padding-bottom:20px;">${logoHtml}</td>
      <td style="vertical-align:top;padding-bottom:20px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1.3;margin-bottom:4px;">
          <a href="${jobUrl}" style="color:#0f172a;text-decoration:none;">${esc(job.title)}</a>
        </div>
        <div style="font-size:13px;color:#475569;margin-bottom:2px;">${esc(companyName)}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">${esc(getLocationLabel(job))} &nbsp;·&nbsp; ${formatFreshness(job.first_detected_at)}</div>
        ${badges ? `<div>${badges}</div>` : ""}
      </td>
    </tr>
  `
}

// ── Extension promo block (like LinkedIn's app download section) ──────────────

function renderExtensionPromo(base: string) {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-top:1px solid #e2e8f0;">
      <tr><td style="padding:28px;text-align:center;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px;">Apply faster with the Hireoven extension</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:20px;line-height:1.5;">
          One-click autofill on Greenhouse, Lever, Ashby and Workday.<br>Your profile, pre-filled. You review before it goes in.
        </div>
        <a href="${esc(base)}/dashboard/autofill"
           style="display:inline-block;background:linear-gradient(135deg,#FF5C18,#FF7A35);color:#fff;text-decoration:none;padding:11px 28px;border-radius:999px;font-size:14px;font-weight:700;letter-spacing:0.01em;">
          Get the Chrome extension
        </a>
      </td></tr>
    </table>
  `
}

// ── Full email shell ──────────────────────────────────────────────────────────

function renderEmailShell({
  preheader,
  headerTitle,
  headerSub,
  jobRowsHtml,
  viewAllUrl,
  viewAllLabel,
  recipientName,
  recipientEmail,
  alertNote,
  manageUrl,
}: {
  preheader: string
  headerTitle: string
  headerSub: string
  jobRowsHtml: string
  viewAllUrl: string
  viewAllLabel: string
  recipientName: string | null
  recipientEmail: string
  alertNote: string
  manageUrl: string
}) {
  const base = getBaseUrl()
  const year = new Date().getFullYear()

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f2ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f3f2ef;">${esc(preheader)}</div>

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ef;padding:24px 16px 0;">
    <tr><td align="center">
      <table width="100%" style="max-width:584px;" cellpadding="0" cellspacing="0">

        <!-- Wordmark header -->
        <tr><td style="padding:0 0 16px;">
          <span style="font-size:20px;font-weight:900;letter-spacing:-0.5px;line-height:1;">
            <span style="color:#FF5C18;">Hire</span><span style="color:#0f172a;">oven</span>
          </span>
        </td></tr>

        <!-- White card -->
        <tr><td style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">

          <!-- Card header -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;">
              <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.2;margin-bottom:4px;">${esc(headerTitle)}</div>
              <div style="font-size:14px;color:#64748b;line-height:1.5;">${esc(headerSub)}</div>
            </td></tr>
          </table>

          <!-- Job list -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:20px 24px 4px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${jobRowsHtml}
              </table>
            </td></tr>
          </table>

          <!-- View all button -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:4px 24px 24px;">
              <a href="${esc(viewAllUrl)}"
                 style="display:inline-block;border:1.5px solid #FF5C18;color:#FF5C18;text-decoration:none;padding:10px 24px;border-radius:999px;font-size:14px;font-weight:700;">
                ${esc(viewAllLabel)}
              </a>
            </td></tr>
          </table>

          <!-- Extension promo -->
          ${renderExtensionPromo(base)}

        </td></tr>

        <!-- LinkedIn-style footer -->
        <tr><td style="padding:24px 4px 32px;">
          <div style="font-size:12px;color:#64748b;line-height:1.7;">
            This email was sent to <strong>${recipientName ? esc(recipientName) + " (" + esc(recipientEmail) + ")" : esc(recipientEmail)}</strong>.<br>
            ${esc(alertNote)}<br>
            <a href="${esc(manageUrl)}" style="color:#64748b;text-decoration:underline;">Manage alerts</a>
            &nbsp;&middot;&nbsp;
            <a href="${esc(manageUrl)}" style="color:#64748b;text-decoration:underline;">Unsubscribe</a>
            &nbsp;&middot;&nbsp;
            <a href="${esc(base)}" style="color:#64748b;text-decoration:underline;">Help</a>
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

function buildAlertDashboardUrl(alertName: string) {
  const url = new URL("/dashboard", getBaseUrl())
  url.searchParams.set("alert", alertName)
  return url.toString()
}

function buildManageAlertsUrl() {
  return new URL("/dashboard/alerts", getBaseUrl()).toString()
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

export async function hasReachedEmailRateLimit(userId: string): Promise<boolean> {
  const pool = getPostgresPool()
  const oneHourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM alert_notifications
     WHERE user_id = $1 AND sent_at >= $2 AND channel IN ('email', 'both')`,
    [userId, oneHourAgo]
  )
  return Number(result.rows[0]?.count ?? 0) >= 10
}

// ── Email senders ─────────────────────────────────────────────────────────────

export async function sendEmailAlert(userId: string, jobs: Job[], alertName: string): Promise<void> {
  if (!resend) throw new Error("Missing RESEND_API_KEY")

  const [profile, hydratedJobs] = await Promise.all([
    getProfileForNotifications(userId),
    hydrateJobs(jobs),
  ])
  if (!profile.email) throw new Error(`User ${userId} has no email address`)

  const total = hydratedJobs.length
  const visible = hydratedJobs.slice(0, 5)
  const jobRowsHtml = visible.map((j, i) => renderJobRow(j, i)).join("")
  const viewAllLabel = total > 5 ? `View all ${total} matching jobs` : "View all matching jobs"

  const html = renderEmailShell({
    preheader: `${total} new job${total === 1 ? "" : "s"} match your alert "${alertName}"`,
    headerTitle: `${total} new job${total === 1 ? "" : "s"} for you`,
    headerSub: `Based on your alert "${alertName}"`,
    jobRowsHtml,
    viewAllUrl: buildAlertDashboardUrl(alertName),
    viewAllLabel,
    recipientName: profile.full_name ?? null,
    recipientEmail: profile.email,
    alertNote: `You're receiving this because of your job alert "${alertName}".`,
    manageUrl: buildManageAlertsUrl(),
  })

  const { error } = await resend.emails.send({
    from: getAlertsFromEmail(),
    to: [profile.email],
    subject: `${total} new job${total === 1 ? "" : "s"} match your alert: ${alertName}`,
    html,
  })
  if (error) throw new Error(error.message)

  await logApiUsage({ service: "resend", operation: "email", tokens_used: null, cost_usd: 0 })
}

export async function sendWatchlistAlert(userId: string, jobs: Job[], companyName: string): Promise<void> {
  if (!resend) throw new Error("Missing RESEND_API_KEY")

  const [profile, hydratedJobs] = await Promise.all([
    getProfileForNotifications(userId),
    hydrateJobs(jobs),
  ])
  if (!profile.email) throw new Error(`User ${userId} has no email address`)

  const total = jobs.length
  const visible = hydratedJobs.slice(0, 5)
  const jobRowsHtml = visible.map((j, i) => renderJobRow(j, i)).join("")

  const html = renderEmailShell({
    preheader: `${companyName} just posted ${total} new job${total === 1 ? "" : "s"}`,
    headerTitle: `${companyName} is hiring`,
    headerSub: `${total} new role${total === 1 ? "" : "s"} just landed from a company on your watchlist.`,
    jobRowsHtml,
    viewAllUrl: new URL("/dashboard/watchlist", getBaseUrl()).toString(),
    viewAllLabel: "View all jobs",
    recipientName: profile.full_name ?? null,
    recipientEmail: profile.email,
    alertNote: `You're receiving this because ${companyName} is on your watchlist.`,
    manageUrl: new URL("/dashboard/watchlist", getBaseUrl()).toString(),
  })

  const { error } = await resend.emails.send({
    from: getAlertsFromEmail(),
    to: [profile.email],
    subject: `${companyName} just posted ${total} new job${total === 1 ? "" : "s"}`,
    html,
  })
  if (error) throw new Error(error.message)

  await logApiUsage({ service: "resend", operation: "watchlist-email", tokens_used: null, cost_usd: 0 })
}

// ── Push notification ─────────────────────────────────────────────────────────

export async function sendPushNotification(userId: string, job: Job, type: "alert" | "watchlist"): Promise<void> {
  configureWebPush()

  const [hydratedJob] = await hydrateJobs([job])
  const subscriptions = await getUserSubscriptions(userId)
  if (!subscriptions.length) throw new Error(`No push subscriptions for user ${userId}`)

  const companyName = hydratedJob.company?.name ?? "Tracked company"
  const payload = JSON.stringify({
    title: type === "watchlist" ? `${companyName} is hiring` : `New match: ${job.title}`,
    body: `${companyName} · ${getLocationLabel(hydratedJob)}`,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data: { jobId: job.id, applyUrl: job.apply_url },
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
      if (statusCode === 404 || statusCode === 410) { await removeSubscription(subscription.endpoint); continue }
      throw error
    }
  }

  if (successCount === 0) throw new Error(`Unable to deliver push notification to user ${userId}`)

  await logApiUsage({ service: "webpush", operation: type, tokens_used: null, cost_usd: 0 })
}

export function combineChannels({ emailSent, pushSent }: { emailSent: boolean; pushSent: boolean }): NotificationChannel | null {
  if (emailSent && pushSent) return "both"
  if (emailSent) return "email"
  if (pushSent) return "push"
  return null
}
