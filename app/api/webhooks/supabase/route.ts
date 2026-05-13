import { NextRequest, NextResponse } from "next/server"
import { matchJobToAlerts, matchJobToWatchlists } from "@/lib/alerts/matcher"
import {
  combineChannels,
  sendPushNotification,
} from "@/lib/alerts/sender"
import { requireWebhookAuth } from "@/lib/env"
import { scoreNewJobForAllUsers } from "@/lib/matching/batch-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import type { AlertFrequency, Job, NotificationChannel, NotificationType } from "@/types"

/**
 * Instant email alerts were removed — every webhook fire used to mail every
 * matching alert regardless of match quality, which burned Resend credit
 * during big crawls. Daily / weekly / recent-jobs digest crons still cover
 * the email channel. This route now only triggers push notifications.
 */

type ProfileChannels = {
  id: string
  email: string | null
  email_alerts: boolean | null
  push_alerts: boolean | null
  alert_frequency: AlertFrequency | null
}

async function fetchProfileChannels(userId: string): Promise<ProfileChannels | null> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<ProfileChannels>(
    `SELECT id, email, email_alerts, push_alerts, alert_frequency FROM profiles WHERE id = $1 LIMIT 1`,
    [userId]
  )
  return rows[0] ?? null
}

async function insertAlertNotificationRow(params: {
  userId: string
  jobId: string
  alertId: string | null
  channel: NotificationChannel
  notificationType: NotificationType
}) {
  const pool = getPostgresPool()
  try {
    await pool.query(
      `INSERT INTO alert_notifications (user_id, job_id, alert_id, channel, notification_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.userId, params.jobId, params.alertId, params.channel, params.notificationType]
    )
  } catch (error) {
    const pgError = error as { code?: string }
    if (pgError.code !== "23505") {
      throw error
    }
  }
}

type WebhookPayload = {
  type: "INSERT" | "UPDATE" | "DELETE"
  table: string
  schema: string
  record: Job | null
  old_record: Job | null
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-supabase-webhook-secret") ?? request.headers.get("authorization")
  if (!requireWebhookAuth(signature)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let payload: WebhookPayload
  try {
    payload = (await request.json()) as WebhookPayload
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  if (payload.type !== "INSERT" || payload.table !== "jobs" || !payload.record) {
    return NextResponse.json({ skipped: true })
  }

  const job = payload.record

  // Return 200 immediately - Supabase retries on non-2xx so we must not block
  void processNotifications(job)
  void scoreNewJobForAllUsers(job)

  return NextResponse.json({ received: true, jobId: job.id })
}

async function processNotifications(job: Job) {
  try {
    const [matchedAlerts, watchlistUserIds] = await Promise.all([
      matchJobToAlerts(job),
      matchJobToWatchlists(job),
    ])

    // Alert notifications - one alert may belong to many users, each alert has user_id
    for (const alert of matchedAlerts) {
      const profile = await fetchProfileChannels(alert.user_id)

      if (!profile) continue

      // Only fire instant pushes for users who explicitly opted into instant
      // frequency. Daily/weekly users are handled by digest crons.
      if (profile.alert_frequency !== "instant") continue

      const channel = combineChannels({
        emailSent: false,
        pushSent: Boolean(profile.push_alerts),
      })
      if (!channel) continue

      try {
        await sendPushNotification(alert.user_id, job, "alert")
        await insertAlertNotificationRow({
          userId: alert.user_id,
          jobId: job.id,
          alertId: alert.id,
          channel,
          notificationType: "alert",
        })
      } catch {
        // Don't let one user's failure block the rest
      }
    }

    // Watchlist notifications
    for (const userId of watchlistUserIds) {
      const profile = await fetchProfileChannels(userId)

      if (!profile) continue

      // Watchlist instant pings only fire for users on instant frequency;
      // daily/weekly users see watchlist hits inside their digest.
      if (profile.alert_frequency !== "instant") continue

      const channel = combineChannels({
        emailSent: false,
        pushSent: Boolean(profile.push_alerts),
      })
      if (!channel) continue

      try {
        await sendPushNotification(userId, job, "watchlist")
        await insertAlertNotificationRow({
          userId: userId,
          jobId: job.id,
          alertId: null,
          notificationType: "watchlist",
          channel,
        })
      } catch {
        // Don't let one user's failure block the rest
      }
    }
  } catch {
    // Silent failure - webhook already returned 200
  }
}
