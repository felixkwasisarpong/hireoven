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

// ── LinkedIn-style job card ───────────────────────────────────────────────────

function renderJobCard(job: JobWithCompanyContext, index: number) {
  const co = job.company
  const companyName = co?.name ?? "Tracked company"
  const logoUrl = co?.logo_url ?? null
  const domain = co?.domain ?? null

  // Company avatar — use logo if available, else styled initial
  const logoHtml = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(companyName)}" width="48" height="48"
          style="width:48px;height:48px;border-radius:8px;object-fit:contain;border:1px solid #e2e8f0;background:#fff;" />`
    : `<div style="width:48px;height:48px;border-radius:8px;background:linear-gradient(135deg,#FF5C18,#FF9A3C);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#fff;text-align:center;line-height:48px;">
         ${esc(companyName.charAt(0).toUpperCase())}
       </div>`

  // Sponsorship pill
  let sponsorPill = ""
  if (job.sponsors_h1b) {
    sponsorPill = `<span style="display:inline-block;background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;">✓ Sponsors H1B</span>`
  } else if (job.requires_authorization) {
    sponsorPill = `<span style="display:inline-block;background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;">No sponsorship</span>`
  } else if ((job.sponsorship_score ?? 0) > 60) {
    sponsorPill = `<span style="display:inline-block;background:#faf5ff;border:1px solid #e9d5ff;color:#7c3aed;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;">Likely sponsors</span>`
  }

  // Remote/hybrid pill
  const workPill = job.is_remote
    ? `<span style="display:inline-block;background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;">Remote</span>`
    : job.is_hybrid
      ? `<span style="display:inline-block;background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;">Hybrid</span>`
      : ""

  const pills = [sponsorPill, workPill].filter(Boolean).join("&nbsp;&nbsp;")

  const jobUrl = `${getBaseUrl()}/dashboard?jobId=${esc(job.id)}`
  const applyUrl = esc(job.apply_url)

  // Divider above cards 2+
  const divider = index > 0
    ? `<div style="height:1px;background:#f1f5f9;margin:0 0 20px;"></div>`
    : ""

  return `
    ${divider}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td style="vertical-align:top;padding-right:14px;width:62px;">${logoHtml}</td>
        <td style="vertical-align:top;">
          <div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1.3;margin-bottom:3px;">
            <a href="${jobUrl}" style="color:#0f172a;text-decoration:none;">${esc(job.title)}</a>
          </div>
          <div style="font-size:13px;color:#475569;font-weight:500;margin-bottom:2px;">${esc(companyName)}</div>
          <div style="font-size:12px;color:#94a3b8;margin-bottom:10px;">${esc(getLocationLabel(job))} &nbsp;·&nbsp; ${formatFreshness(job.first_detected_at)}</div>
          ${pills ? `<div style="margin-bottom:14px;">${pills}</div>` : ""}
          <a href="${applyUrl}" target="_blank"
             style="display:inline-block;background:linear-gradient(135deg,#FF5C18,#FF7A35);color:#ffffff;text-decoration:none;padding:9px 20px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:0.01em;">
            Apply now
          </a>
        </td>
      </tr>
    </table>
  `
}

// ── Email shell ───────────────────────────────────────────────────────────────

function renderEmailShell({
  preheader,
  headerTitle,
  headerSub,
  body,
  footerHtml,
}: {
  preheader: string
  headerTitle: string
  headerSub: string
  body: string
  footerHtml: string
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f8fafc;">${esc(preheader)}</div>

  <!-- Wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;" cellpadding="0" cellspacing="0">

        <!-- Logo bar -->
        <tr><td style="padding-bottom:20px;text-align:left;">
          <span style="font-size:18px;font-weight:900;letter-spacing:-0.5px;">
            <span style="color:#FF5C18;">Hire</span><span style="color:#0f172a;">oven</span>
          </span>
        </td></tr>

        <!-- Main card -->
        <tr><td style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 8px rgba(15,23,42,0.06);">

          <!-- Header strip -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:24px 28px 20px;border-bottom:1px solid #f1f5f9;">
                <div style="font-size:20px;font-weight:800;color:#0f172a;line-height:1.25;margin-bottom:6px;">
                  ${esc(headerTitle)}
                </div>
                <div style="font-size:14px;color:#64748b;line-height:1.5;">
                  ${esc(headerSub)}
                </div>
              </td>
            </tr>
          </table>

          <!-- Body -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:24px 28px;">
              ${body}
            </td></tr>
          </table>

          <!-- Footer inside card -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:16px 28px 24px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8;line-height:1.6;">
              ${footerHtml}
            </td></tr>
          </table>

        </td></tr>

        <!-- Bottom note -->
        <tr><td style="padding-top:20px;text-align:center;font-size:11px;color:#cbd5e1;">
          Hireoven · Jobs served fresh · <a href="${esc(getBaseUrl())}/dashboard/alerts" style="color:#94a3b8;text-decoration:underline;">Manage alerts</a>
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

  const firstName = profile.full_name?.split(" ")[0] ?? null
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,"
  const visible = hydratedJobs.slice(0, 5)
  const total = hydratedJobs.length
  const cardsHtml = visible.map((j, i) => renderJobCard(j, i)).join("")

  const viewAllHtml = total > 5
    ? `<div style="text-align:center;margin-top:8px;">
         <a href="${esc(buildAlertDashboardUrl(alertName))}"
            style="display:inline-block;border:1.5px solid #FF5C18;color:#FF5C18;text-decoration:none;padding:9px 22px;border-radius:999px;font-size:13px;font-weight:700;">
           View all ${total} jobs →
         </a>
       </div>`
    : ""

  const html = renderEmailShell({
    preheader: `${total} new job${total === 1 ? "" : "s"} match your alert "${alertName}"`,
    headerTitle: `${total} new job${total === 1 ? "" : "s"} for you`,
    headerSub: `${greeting} Your alert "${alertName}" matched ${total} fresh role${total === 1 ? "" : "s"}.`,
    body: `${cardsHtml}${viewAllHtml}`,
    footerHtml: `You're receiving this because of your job alert <strong>"${esc(alertName)}"</strong>.
      &nbsp;<a href="${esc(buildManageAlertsUrl())}" style="color:#64748b;text-decoration:underline;">Manage alerts</a>`,
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

  const firstName = profile.full_name?.split(" ")[0] ?? null
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,"
  const visible = hydratedJobs.slice(0, 5)
  const total = jobs.length
  const cardsHtml = visible.map((j, i) => renderJobCard(j, i)).join("")

  const html = renderEmailShell({
    preheader: `${companyName} just posted ${total} new job${total === 1 ? "" : "s"}`,
    headerTitle: `${companyName} is hiring`,
    headerSub: `${greeting} ${total} new role${total === 1 ? "" : "s"} just landed from a company on your watchlist.`,
    body: cardsHtml,
    footerHtml: `This was triggered by your watchlist.
      &nbsp;<a href="${esc(new URL("/dashboard/watchlist", getBaseUrl()).toString())}" style="color:#64748b;text-decoration:underline;">Manage watchlist</a>`,
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
