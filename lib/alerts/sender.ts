import webpush from "web-push"
import { logApiUsage } from "@/lib/admin/usage"
import { removeSubscription, getUserSubscriptions } from "@/lib/alerts/push-subscriptions"
import { env } from "@/lib/env"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Company, Job, NotificationChannel } from "@/types"

type JobWithCompanyContext = Job & {
  company: Pick<Company, "id" | "name" | "logo_url" | "domain" | "sponsors_h1b"> | null
}

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const email = env.VAPID_EMAIL
  if (!publicKey || !privateKey || !email) throw new Error("Missing VAPID environment variables")
  webpush.setVapidDetails(email, publicKey, privateKey)
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

function getLocationLabel(job: JobWithCompanyContext) {
  if (job.is_remote && job.location) return `${job.location} · Remote`
  if (job.is_remote) return "Remote"
  if (job.is_hybrid && job.location) return `Hybrid · ${job.location}`
  return job.location ?? "Location not listed"
}

// ── Push notification ─────────────────────────────────────────────────────────
//
// Instant per-job email alerts (and their watchlist sibling) used to live in
// this file. They burned Resend credit on every crawl tick — every matching
// alert fired an email regardless of match quality, and during a big harvest
// that meant hundreds of low-signal sends. We removed those senders entirely.
// Daily / weekly digests + recent-jobs crons remain (they call resend
// directly, not through this module). Push notifications stay because the
// device-side opt-in already provides quality control and they don't cost
// per-send.

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
