import { NextRequest, NextResponse } from "next/server"
import { matchJobToAlerts, matchJobToWatchlists } from "@/lib/alerts/matcher"
import {
  combineChannels,
  hasReachedEmailRateLimit,
  sendEmailAlert,
  sendPushNotification,
  sendWatchlistAlert,
} from "@/lib/alerts/sender"
import { verifyWebhookSignature } from "@/lib/alerts/webhook"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Job, JobAlert, NotificationType, Profile } from "@/types"

type JobWebhookPayload = {
  type?: "INSERT" | "UPDATE" | "DELETE"
  table?: string
  schema?: string
  record?: Job | null
  old_record?: Job | null
}

type NotificationProfile = Pick<
  Profile,
  "id" | "alert_frequency" | "email_alerts" | "push_alerts"
>

type TriggerSummary = {
  matchedAlerts: number
  matchedWatchlists: number
  emailSent: number
  pushSent: number
  queued: number
  duplicatesSkipped: number
  notificationsLogged: number
  rateLimitedEmails: number
  errors: string[]
}

function parseJobPayload(payload: unknown): Job | null {
  if (!payload || typeof payload !== "object") return null

  const typedPayload = payload as JobWebhookPayload
  if (typedPayload.record && typedPayload.type === "INSERT") {
    return typedPayload.record
  }

  const maybeJob = payload as Partial<Job>
  if (
    typeof maybeJob.id === "string" &&
    typeof maybeJob.company_id === "string" &&
    typeof maybeJob.title === "string" &&
    typeof maybeJob.apply_url === "string"
  ) {
    return maybeJob as Job
  }

  return null
}

async function fetchProfiles(userIds: string[]) {
  if (!userIds.length) return new Map<string, NotificationProfile>()

  const pool = getPostgresPool()
  const result = await pool.query<NotificationProfile>(
    `SELECT id, alert_frequency, email_alerts, push_alerts
     FROM profiles
     WHERE id = ANY($1::uuid[])`,
    [userIds]
  )
  const data = result.rows

  return new Map(
    data.map((profile) => [profile.id, profile])
  )
}

async function fetchCompanyName(companyId: string) {
  const pool = getPostgresPool()
  const result = await pool.query<{ name: string }>(
    `SELECT name
     FROM companies
     WHERE id = $1
     LIMIT 1`,
    [companyId]
  )
  return result.rows[0]?.name ?? "A company you watch"
}

async function fetchExistingNotifications(jobId: string, userIds: string[]) {
  if (!userIds.length) return new Set<string>()

  const pool = getPostgresPool()
  const result = await pool.query<{ user_id: string | null }>(
    `SELECT user_id
     FROM alert_notifications
     WHERE job_id = $1
       AND user_id = ANY($2::uuid[])`,
    [jobId, userIds]
  )
  const data = result.rows

  return new Set(
    data
      .map((row) => row.user_id)
      .filter((value): value is string => Boolean(value))
  )
}

async function touchAlerts(alerts: JobAlert[]) {
  if (!alerts.length) return

  const pool = getPostgresPool()
  const alertIds = alerts.map((alert) => alert.id)

  await pool.query(
    `UPDATE job_alerts
     SET last_triggered_at = $1
     WHERE id = ANY($2::uuid[])`,
    [new Date().toISOString(), alertIds]
  )
}

async function insertNotificationLog({
  userId,
  jobId,
  alertId,
  channel,
  notificationType,
}: {
  userId: string
  jobId: string
  alertId: string | null
  channel: "email" | "push" | "both"
  notificationType: NotificationType
}) {
  const pool = getPostgresPool()
  try {
    await pool.query(
      `INSERT INTO alert_notifications (user_id, job_id, alert_id, channel, notification_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, jobId, alertId, channel, notificationType]
    )
  } catch (error) {
    const pgError = error as { code?: string }
    if (pgError.code !== "23505") {
      throw error
    }
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  if (!verifyWebhookSignature(rawBody, request.headers)) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 })
  }

  const payload = JSON.parse(rawBody) as JobWebhookPayload | Job
  const job = parseJobPayload(payload)

  if (!job) {
    return NextResponse.json({ error: "Missing job payload" }, { status: 400 })
  }

  const summary: TriggerSummary = {
    matchedAlerts: 0,
    matchedWatchlists: 0,
    emailSent: 0,
    pushSent: 0,
    queued: 0,
    duplicatesSkipped: 0,
    notificationsLogged: 0,
    rateLimitedEmails: 0,
    errors: [],
  }

  try {
    const [matchedAlerts, watchlistUsers, companyName] = await Promise.all([
      matchJobToAlerts(job),
      matchJobToWatchlists(job),
      fetchCompanyName(job.company_id),
    ])

    summary.matchedAlerts = matchedAlerts.length
    summary.matchedWatchlists = watchlistUsers.length

    const alertsByUser = new Map<string, JobAlert[]>()
    for (const alert of matchedAlerts) {
      const current = alertsByUser.get(alert.user_id) ?? []
      current.push(alert)
      alertsByUser.set(alert.user_id, current)
    }

    const userIds = Array.from(
      new Set(Array.from(alertsByUser.keys()).concat(watchlistUsers))
    )
    const [profileMap, existingNotifications] = await Promise.all([
      fetchProfiles(userIds),
      fetchExistingNotifications(job.id, userIds),
    ])

    for (const [userId, alerts] of Array.from(alertsByUser.entries())) {
      if (existingNotifications.has(userId)) {
        summary.duplicatesSkipped += 1
        continue
      }

      const profile = profileMap.get(userId)
      if (!profile) {
        summary.errors.push(`Missing profile for alert user ${userId}`)
        continue
      }

      await touchAlerts(alerts)

      if (profile.alert_frequency !== "instant") {
        console.info(
          `[alerts] queued ${profile.alert_frequency} digest for user ${userId} and job ${job.id}`
        )
        summary.queued += 1
        continue
      }

      const primaryAlert = alerts[0]
      let emailSent = false
      let pushSent = false

      if (profile.email_alerts) {
        try {
          const limited = await hasReachedEmailRateLimit(userId)
          if (limited) {
            summary.rateLimitedEmails += 1
            console.warn(`[alerts] email rate limit hit for user ${userId}`)
          } else {
            await sendEmailAlert(userId, [job], primaryAlert.name ?? "Saved alert")
            emailSent = true
            summary.emailSent += 1
          }
        } catch (error) {
          console.error("[alerts] email send failed", error)
          summary.errors.push(
            `Alert email failed for user ${userId}: ${(error as Error).message}`
          )
        }
      }

      if (profile.push_alerts) {
        try {
          await sendPushNotification(userId, job, "alert")
          pushSent = true
          summary.pushSent += 1
        } catch (error) {
          console.error("[alerts] push send failed", error)
          summary.errors.push(
            `Alert push failed for user ${userId}: ${(error as Error).message}`
          )
        }
      }

      const channel = combineChannels({ emailSent, pushSent })
      if (!channel) continue

      await insertNotificationLog({
        userId,
        jobId: job.id,
        alertId: primaryAlert.id,
        channel,
        notificationType: "alert",
      })

      existingNotifications.add(userId)
      summary.notificationsLogged += 1
    }

    for (const userId of watchlistUsers) {
      if (existingNotifications.has(userId)) {
        summary.duplicatesSkipped += 1
        continue
      }

      const profile = profileMap.get(userId)
      if (!profile) {
        summary.errors.push(`Missing profile for watchlist user ${userId}`)
        continue
      }

      let emailSent = false
      let pushSent = false

      if (profile.email_alerts) {
        try {
          const limited = await hasReachedEmailRateLimit(userId)
          if (limited) {
            summary.rateLimitedEmails += 1
            console.warn(`[alerts] email rate limit hit for watchlist user ${userId}`)
          } else {
            await sendWatchlistAlert(userId, [job], companyName)
            emailSent = true
            summary.emailSent += 1
          }
        } catch (error) {
          console.error("[alerts] watchlist email failed", error)
          summary.errors.push(
            `Watchlist email failed for user ${userId}: ${(error as Error).message}`
          )
        }
      }

      if (profile.push_alerts) {
        try {
          await sendPushNotification(userId, job, "watchlist")
          pushSent = true
          summary.pushSent += 1
        } catch (error) {
          console.error("[alerts] watchlist push failed", error)
          summary.errors.push(
            `Watchlist push failed for user ${userId}: ${(error as Error).message}`
          )
        }
      }

      const channel = combineChannels({ emailSent, pushSent })
      if (!channel) continue

      await insertNotificationLog({
        userId,
        jobId: job.id,
        alertId: null,
        channel,
        notificationType: "watchlist",
      })

      existingNotifications.add(userId)
      summary.notificationsLogged += 1
    }
  } catch (error) {
    console.error("[alerts] trigger failed", error)
    return NextResponse.json(
      {
        error: "Failed to process alert trigger",
        details: (error as Error).message,
        summary,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, summary })
}
