import webpush from "web-push"
import { Resend } from "resend"
import { logApiUsage } from "@/lib/admin/usage"
import { notificationFreshnessDate } from "@/lib/alerts/job-freshness"
import { isDeadSubscriptionError, removeSubscription, getUserSubscriptions } from "@/lib/alerts/push-subscriptions"
import {
  INSTANT_EMAIL_TARGET_ROWS,
  fetchPreviouslySentInstantJobs,
  slotsFor,
} from "@/lib/alerts/previous-instant-jobs"
import { getEmailBaseUrl, getHireovenEmailLogoUrl } from "@/lib/email/branding"
import { extractDomainFromLogoDevUrl, resolveLogoDomainOverride } from "@/lib/companies/logo-url"
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
  return getEmailBaseUrl()
}

export function configureWebPush() {
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

/** Returns an absolute proxy URL so email clients fetch logos through our
 *  server rather than hitting logo.dev directly (which validates the request
 *  origin and rejects requests from email-client IP ranges). */
// Synthetic/discovery domains (adzuna-*.placeholder, *.greenhouse.discovered,
// *.pinpoint-tenant, …) have no real logo — render the letter avatar instead of
// a broken/globe image.
const PLACEHOLDER_DOMAIN_RE = /placeholder|discovered|-employer|-tenant|\.apex(\b|$)/i
function realDomain(domain: string | null | undefined): string | null {
  if (!domain) return null
  const d = domain.trim().toLowerCase()
  return PLACEHOLDER_DOMAIN_RE.test(d) ? null : d
}

function logoProxyUrl(domain: string | null | undefined): string | null {
  if (!domain) return null
  const base = getBaseUrl()
  return `${base}/api/logo?domain=${encodeURIComponent(domain.trim().toLowerCase())}`
}

/**
 * Prefer the domain embedded in an already-resolved logo.dev URL over
 * `companies.domain` — a later discovery pass frequently overwrites `domain`
 * with an internal placeholder (*-tenant, *.discovered, …) while `logo_url`
 * still holds the correct value from an earlier backfill. Falls back to
 * `domain` (through the same brand-override map the main feed uses, e.g.
 * jj.com -> jnj.com) when `logo_url` isn't a usable logo.dev URL.
 */
export function resolveCompanyLogoDomain(co: Pick<Company, "logo_url" | "domain"> | null | undefined): string | null {
  const fromLogoUrl = extractDomainFromLogoDevUrl(co?.logo_url)
  if (fromLogoUrl) return fromLogoUrl
  const real = realDomain(co?.domain)
  return real ? resolveLogoDomainOverride(real) : null
}

function renderJobRow(job: JobWithCompanyContext, index: number, matchScore?: number | null) {
  const co = job.company
  const companyName = co?.name ?? "Tracked company"
  const proxyUrl = logoProxyUrl(resolveCompanyLogoDomain(co))

  const logoHtml = proxyUrl
    ? `<img src="${esc(proxyUrl)}" alt="${esc(companyName)}" width="56" height="56"
          style="width:56px;height:56px;border-radius:10px;object-fit:contain;border:1px solid #e2e8f0;background:#fff;display:block;" />`
    : `<div style="width:56px;height:56px;border-radius:10px;background:linear-gradient(135deg,#FF5C18,#FF9A3C);font-size:22px;font-weight:800;color:#fff;text-align:center;line-height:56px;">${esc(companyName.charAt(0).toUpperCase())}</div>`

  // Real AI match score (0–100) when available, shown as an "X% match" badge.
  const matchBadge = matchScore != null && matchScore >= 1
    ? (() => {
        const s = Math.round(matchScore)
        const color = s >= 85 ? "#15803d" : "#1d4ed8"
        const bg   = s >= 85 ? "#f0fdf4" : "#eff6ff"
        const bd   = s >= 85 ? "#bbf7d0" : "#bfdbfe"
        return `<span style="display:inline-block;background:${bg};border:1px solid ${bd};color:${color};border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;">${s}% match</span>`
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

  // Deep-link straight to the job detail page (the old /dashboard?jobId= form
  // was never consumed by the feed — users landed on the generic feed). ntf=1
  // marks an email-notification referral so the page stamps clicked_at.
  const jobUrl = new URL(`/dashboard/jobs/${job.id}`, getBaseUrl())
  jobUrl.searchParams.set("ntf", "1")
  const divider = index > 0 ? `<tr><td colspan="2" style="padding:0 0 18px;"><div style="height:1px;background:#f1f5f9;"></div></td></tr>` : ""

  return `
    ${divider}
    <tr>
      <td width="72" style="vertical-align:top;padding-right:16px;width:72px;padding-bottom:20px;">${logoHtml}</td>
      <td width="100%" style="vertical-align:top;padding-bottom:20px;word-break:break-word;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1.3;margin-bottom:4px;">
          <a href="${esc(jobUrl.toString())}" style="color:#0f172a;text-decoration:none;">${esc(job.title)}</a>
        </div>
        <div style="font-size:13px;color:#475569;margin-bottom:2px;">${esc(companyName)}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">${esc(getLocationLabel(job))} &nbsp;·&nbsp; ${formatFreshness(String(notificationFreshnessDate(job) ?? job.first_detected_at))}</div>
        ${badges ? `<div>${badges}</div>` : ""}
      </td>
    </tr>
  `
}


// ── Full email shell ──────────────────────────────────────────────────────────

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/hireoven-apex-bridge/mkmfffcaimjnaecoelnanifookmdbfok"

/**
 * Email-safe promo block for the Chrome extension. Rendered between the
 * white job card and the footer in every alert/digest email. Inline-styled
 * tables for maximum email-client compatibility (Gmail, Outlook, Apple Mail).
 */
function renderExtensionPromoBlock(baseUrl: string): string {
  const learnMoreUrl = `${baseUrl}/extension`
  return `
        <!-- Chrome extension promo -->
        <tr><td style="padding:18px 0 0;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0C0A1E 0%,#1a0a2e 100%);border-radius:10px;overflow:hidden;">
            <tr><td style="padding:18px 22px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;width:44px;">
                    <div style="width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg,#FF5C18,#FF9A3C);text-align:center;line-height:36px;font-size:18px;">🧩</div>
                  </td>
                  <td style="vertical-align:middle;padding-left:12px;">
                    <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;color:#FF9A3C;text-transform:uppercase;">New · Chrome extension</div>
                    <div style="font-size:14px;font-weight:600;color:#ffffff;line-height:1.4;margin-top:2px;">
                      Get match scores &amp; autofill on every job posting.
                    </div>
                  </td>
                </tr>
              </table>
              <table cellpadding="0" cellspacing="0" style="margin-top:12px;">
                <tr>
                  <td>
                    <a href="${esc(CHROME_STORE_URL)}"
                       style="display:inline-block;background:#ffffff;color:#0C0A1E;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:12.5px;font-weight:700;">
                      Add to Chrome — free
                    </a>
                  </td>
                  <td style="padding-left:8px;">
                    <a href="${esc(learnMoreUrl)}"
                       style="display:inline-block;color:rgba(255,255,255,0.75);text-decoration:none;padding:8px 12px;font-size:12.5px;font-weight:600;">
                      Learn more →
                    </a>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>
`
}

/**
 * Captioned "previously sent" block appended under the new jobs — a visual
 * break, a caption saying plainly that these are earlier alerts, then the rows.
 * Keeps a one-job instant email from looking empty without pretending the
 * recap roles are new (see lib/alerts/previous-instant-jobs.ts).
 */
function renderRecapSection(rowsHtml: string, caption: string, subCaption: string) {
  if (!rowsHtml) return ""
  return `
    <tr><td colspan="2" style="padding:6px 0 18px;">
      <div style="height:1px;background:#e2e8f0;"></div>
    </td></tr>
    <tr><td colspan="2" style="padding:0 0 16px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">${esc(caption)}</div>
      <div style="font-size:13px;color:#64748b;line-height:1.5;">${esc(subCaption)}</div>
    </td></tr>
    ${rowsHtml}
  `
}

function renderEmailShell({
  preheader,
  headerTitle,
  headerSub,
  jobRowsHtml,
  recapRowsHtml = "",
  recapCaption = "",
  recapSubCaption = "",
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
  recapRowsHtml?: string
  recapCaption?: string
  recapSubCaption?: string
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
          <img src="${getHireovenEmailLogoUrl("wordmark")}" alt="Hireoven" height="28"
               style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none;" />
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
                ${renderRecapSection(recapRowsHtml, recapCaption, recapSubCaption)}
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

        </td></tr>

        ${renderExtensionPromoBlock(base)}

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
            <img src="${getHireovenEmailLogoUrl("wordmark")}" alt="Hireoven" height="20"
                 style="display:block;height:20px;width:auto;border:0;outline:none;text-decoration:none;" />
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
  const url = new URL("/dashboard/matches", getBaseUrl())
  url.searchParams.set("alert", alertName)
  url.searchParams.set("source", "email-alert")
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

export async function sendEmailAlert(
  userId: string,
  jobs: Job[],
  alertName: string,
  scores?: ReadonlyMap<string, { overall_score: number }>,
): Promise<void> {
  if (!resend) throw new Error("Missing RESEND_API_KEY")

  const [profile, hydratedJobs] = await Promise.all([
    getProfileForNotifications(userId),
    hydrateJobs(jobs),
  ])
  if (!profile.email) throw new Error(`User ${userId} has no email address`)

  const total = hydratedJobs.length
  const visible = hydratedJobs.slice(0, INSTANT_EMAIL_TARGET_ROWS)
  const jobRowsHtml = visible.map((j, i) => renderJobRow(j, i, scores?.get(j.id)?.overall_score)).join("")
  const viewAllLabel = total > INSTANT_EMAIL_TARGET_ROWS ? `See all ${total} matches` : "View all matching jobs"

  // Top the email up with earlier instant matches that are still open, so a
  // single-job alert isn't a near-empty send. Counts above stay new-jobs-only.
  const recap = await fetchPreviouslySentInstantJobs({
    userId,
    notificationType: "alert",
    excludeJobIds: hydratedJobs.map((j) => j.id),
    limit: slotsFor(visible.length),
  })
  const recapRowsHtml = recap.jobs.length
    ? (await hydrateJobs(recap.jobs))
        .map((j, i) => renderJobRow(j, i, recap.scores.get(j.id)?.overall_score))
        .join("")
    : ""

  const topCompanies = [...new Set(visible.slice(0, 2).map(j => j.company?.name).filter(Boolean))]
  const companyStr = topCompanies.length > 0
    ? ` from ${topCompanies.join(" and ")}${total > topCompanies.length ? ` +${total - topCompanies.length} more` : ""}`
    : ""

  const subject = total === 1
    ? `New match${companyStr} — "${alertName}"`
    : `${total} new matches${companyStr} — "${alertName}"`

  const headerSub = topCompanies.length > 0
    ? `Roles from ${topCompanies.join(", ")}${total > topCompanies.length ? ` and ${total - topCompanies.length} more` : ""} matched your alert.`
    : `${total} role${total === 1 ? "" : "s"} matched your alert.`

  const html = renderEmailShell({
    preheader: subject,
    headerTitle: total === 1 ? "1 new match for you" : `${total} new matches for you`,
    headerSub,
    jobRowsHtml,
    recapRowsHtml,
    recapCaption: "Earlier matches · still open",
    recapSubCaption:
      recap.jobs.length === 1
        ? "From a recent alert — this role is still live and you haven't tracked it yet."
        : "From your recent alerts — these roles are still live and untracked.",
    viewAllUrl: buildAlertDashboardUrl(alertName),
    viewAllLabel,
    recipientName: profile.full_name ?? null,
    recipientEmail: profile.email,
    alertNote: `You're receiving this because of your saved alert "${alertName}".`,
    manageUrl: buildManageAlertsUrl(),
  })

  const { error } = await resend.emails.send({
    from: getAlertsFromEmail(),
    to: [profile.email],
    subject,
    html,
  })
  if (error) throw new Error(error.message)

  await logApiUsage({ service: "resend", operation: "email", tokens_used: null, cost_usd: 0 })
}

// ── Push notification ─────────────────────────────────────────────────────────

export async function sendPushNotification(userId: string, job: Job, type: "alert" | "watchlist" | "sponsor_match"): Promise<void> {
  configureWebPush()

  const [hydratedJob] = await hydrateJobs([job])
  const subscriptions = await getUserSubscriptions(userId)
  if (!subscriptions.length) throw new Error(`No push subscriptions for user ${userId}`)

  const companyName = hydratedJob.company?.name ?? "Tracked company"
  const title =
    type === "sponsor_match"
      ? `⚡ Sponsor role just dropped: ${job.title}`
      : type === "watchlist"
        ? `${companyName} is hiring`
        : `New match: ${job.title}`
  const payload = JSON.stringify({
    title,
    body:
      type === "sponsor_match"
        ? `${companyName} · ${getLocationLabel(hydratedJob)} · Likely H-1B sponsor — apply first`
        : `${companyName} · ${getLocationLabel(hydratedJob)}`,
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
      if (isDeadSubscriptionError(error)) { await removeSubscription(subscription.endpoint); continue }
      throw error
    }
  }

  if (successCount === 0) throw new Error(`Unable to deliver push notification to user ${userId}`)

  await logApiUsage({ service: "webpush", operation: type, tokens_used: null, cost_usd: 0 })
}

/**
 * One push summarizing a batch of new matches, so a harvest/crawl that lands
 * many matching jobs at once doesn't fire a separate ping per job. Delegates to
 * the single-job push for a batch of one.
 */
export async function sendBatchPushNotification(
  userId: string,
  jobs: Job[],
  type: "alert" | "watchlist" | "sponsor_match",
): Promise<void> {
  if (jobs.length === 0) return
  if (jobs.length === 1) return sendPushNotification(userId, jobs[0], type)

  configureWebPush()
  const subscriptions = await getUserSubscriptions(userId)
  if (!subscriptions.length) throw new Error(`No push subscriptions for user ${userId}`)

  const [first] = await hydrateJobs([jobs[0]])
  const companyName = first.company?.name ?? "a company"
  const n = jobs.length
  const title =
    type === "sponsor_match"
      ? `⚡ ${n} new sponsor-friendly roles`
      : type === "watchlist"
        ? `${n} new roles at ${companyName}`
        : `${n} new job matches`
  const payload = JSON.stringify({
    title,
    body: `${jobs[0].title} at ${companyName}, and ${n - 1} more`,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    data: { count: n, jobIds: jobs.slice(0, 12).map((j) => j.id) },
    actions: [
      { action: "view", title: "View matches" },
      { action: "dismiss", title: "Dismiss" },
    ],
  })

  let successCount = 0
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, payload)
      successCount += 1
    } catch (error) {
      if (isDeadSubscriptionError(error)) { await removeSubscription(subscription.endpoint); continue }
      throw error
    }
  }

  if (successCount === 0) throw new Error(`Unable to deliver push notification to user ${userId}`)
  await logApiUsage({ service: "webpush", operation: `${type}_batch`, tokens_used: null, cost_usd: 0 })
}

export async function sendWatchlistEmail(
  userId: string,
  jobs: Job[],
): Promise<void> {
  if (!resend) throw new Error("Missing RESEND_API_KEY")

  const [profile, hydratedJobs] = await Promise.all([
    getProfileForNotifications(userId),
    hydrateJobs(jobs),
  ])
  if (!profile.email) throw new Error(`User ${userId} has no email address`)

  const total = hydratedJobs.length
  const visible = hydratedJobs.slice(0, INSTANT_EMAIL_TARGET_ROWS)
  const jobRowsHtml = visible.map((j, i) => renderJobRow(j, i, null)).join("")

  const recap = await fetchPreviouslySentInstantJobs({
    userId,
    notificationType: "watchlist",
    excludeJobIds: hydratedJobs.map((j) => j.id),
    limit: slotsFor(visible.length),
  })
  const recapRowsHtml = recap.jobs.length
    ? (await hydrateJobs(recap.jobs)).map((j, i) => renderJobRow(j, i, null)).join("")
    : ""

  const companies = [...new Set(hydratedJobs.map((j) => j.company?.name).filter(Boolean))]
  const companyStr =
    companies.length === 1
      ? (companies[0] as string)
      : companies.length === 2
        ? `${companies[0]} and ${companies[1]}`
        : `${companies[0]}, ${companies[1]}, and ${companies.length - 2} more`

  const subject =
    total === 1
      ? `New role at ${companyStr}`
      : `${total} new roles at ${companies.length === 1 ? companyStr : "companies you follow"}`

  const headerSub =
    companies.length === 1
      ? `${companies[0]} just posted ${total === 1 ? "a new role" : `${total} new roles`}.`
      : `${companies.length} companies you follow posted ${total} new role${total === 1 ? "" : "s"}.`

  const html = renderEmailShell({
    preheader: subject,
    headerTitle: "Companies you follow are hiring",
    headerSub,
    jobRowsHtml,
    recapRowsHtml,
    recapCaption: "Earlier roles · still open",
    recapSubCaption:
      recap.jobs.length === 1
        ? "From a recent update on the companies you follow — still live and untracked."
        : "From recent updates on the companies you follow — still live and untracked.",
    viewAllUrl: `${getBaseUrl()}/dashboard`,
    viewAllLabel: total > INSTANT_EMAIL_TARGET_ROWS ? `See all ${total} new roles` : "View new roles",
    recipientName: profile.full_name ?? null,
    recipientEmail: profile.email,
    alertNote: "You're receiving this because you're following these companies on Hireoven.",
    manageUrl: `${getBaseUrl()}/dashboard/alerts`,
  })

  const { error } = await resend.emails.send({
    from: getAlertsFromEmail(),
    to: [profile.email],
    subject,
    html,
  })
  if (error) throw new Error(error.message)

  await logApiUsage({ service: "resend", operation: "email", tokens_used: null, cost_usd: 0 })
}

export function combineChannels({ emailSent, pushSent }: { emailSent: boolean; pushSent: boolean }): NotificationChannel | null {
  if (emailSent && pushSent) return "both"
  if (emailSent) return "email"
  if (pushSent) return "push"
  return null
}
