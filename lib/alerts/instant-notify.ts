/**
 * Instant-notification pipeline (shared).
 *
 * Runs a newly-detected job through alert + watchlist matching and the
 * sponsor-match push, for users on "instant" frequency. Extracted from the
 * Supabase webhook so the harvester-driven notify cron can reuse the exact same
 * logic — the webhook only ever fired for Supabase-cloud inserts, which the
 * self-hosted harvester bypasses, so harvested jobs produced no instant alerts.
 *
 * Idempotent: each (user, job, type) is recorded in alert_notifications and
 * re-checked before sending, so the cron can reprocess overlapping time windows
 * without double-notifying. (Single-threaded cron ⇒ no TOCTOU race.)
 */
import {
  combineChannels,
  sendEmailAlert,
  sendPushNotification,
  sendWatchlistAlert,
} from "@/lib/alerts/sender"
import { matchJobToAlerts, matchJobToWatchlists } from "@/lib/alerts/matcher"
import { shouldSponsorPush } from "@/lib/alerts/sponsor-match"
import { scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import type { AlertFrequency, Job, NotificationChannel, NotificationType } from "@/types"

const INSTANT_EMAIL_MIN_MATCH_SCORE = 75

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
    [userId],
  )
  return rows[0] ?? null
}

/** Idempotency guard: has this user already been notified about this job/type? */
async function alreadyNotified(userId: string, jobId: string, type: NotificationType): Promise<boolean> {
  const pool = getPostgresPool()
  const { rows } = await pool.query(
    `SELECT 1 FROM alert_notifications
      WHERE user_id = $1 AND job_id = $2 AND notification_type = $3 LIMIT 1`,
    [userId, jobId, type],
  )
  return rows.length > 0
}

async function recordNotification(params: {
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
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, job_id, notification_type) DO NOTHING`,
      [params.userId, params.jobId, params.alertId, params.channel, params.notificationType],
    )
  } catch (error) {
    const pgError = error as { code?: string }
    if (pgError.code !== "23505") throw error
  }
}

/**
 * Match a job against alerts/watchlists/sponsor-seekers and fire instant
 * notifications for instant-frequency users. Safe to call repeatedly for the
 * same job.
 */
export async function processNotifications(job: Job): Promise<void> {
  try {
    // Users already pinged for this job in this run — so the watchlist + sponsor
    // passes never double-notify someone the alert pass already reached.
    const notifiedUserIds = new Set<string>()

    const [matchedAlerts, watchlistUserIds] = await Promise.all([
      matchJobToAlerts(job),
      matchJobToWatchlists(job),
    ])

    // ── Alert matches ─────────────────────────────────────────────────────────
    for (const alert of matchedAlerts) {
      const profile = await fetchProfileChannels(alert.user_id)
      if (!profile) continue
      if (profile.alert_frequency !== "instant") continue
      if (await alreadyNotified(alert.user_id, job.id, "alert")) {
        notifiedUserIds.add(alert.user_id)
        continue
      }

      // Score-quality gate for email; users with no scorable resume fall through.
      let belowThreshold = false
      try {
        const matchScore = (await scoreJobsForUser(alert.user_id, [job.id])).get(job.id)
        if (matchScore && matchScore.overall_score < INSTANT_EMAIL_MIN_MATCH_SCORE) belowThreshold = true
      } catch {
        // scoring failure shouldn't block the alert
      }

      const channel = combineChannels({
        emailSent: Boolean(profile.email_alerts) && !belowThreshold,
        pushSent: Boolean(profile.push_alerts),
      })
      if (!channel) continue

      try {
        if (channel === "email" || channel === "both") await sendEmailAlert(alert.user_id, [job], alert.name ?? "Job alert")
        if (channel === "push" || channel === "both") await sendPushNotification(alert.user_id, job, "alert")
        await recordNotification({ userId: alert.user_id, jobId: job.id, alertId: alert.id, channel, notificationType: "alert" })
        notifiedUserIds.add(alert.user_id)
      } catch {
        // don't let one user's failure block the rest
      }
    }

    // ── Watchlist matches ──────────────────────────────────────────────────────
    if (watchlistUserIds.length > 0) {
      const pool = getPostgresPool()
      const companyResult = await pool.query<{ name: string }>(
        `SELECT name FROM companies WHERE id = $1 LIMIT 1`,
        [job.company_id],
      )
      const companyName = companyResult.rows[0]?.name ?? "Tracked company"

      for (const userId of watchlistUserIds) {
        if (notifiedUserIds.has(userId)) continue
        const profile = await fetchProfileChannels(userId)
        if (!profile) continue
        if (profile.alert_frequency !== "instant") continue
        if (await alreadyNotified(userId, job.id, "watchlist")) continue

        const channel = combineChannels({
          emailSent: Boolean(profile.email_alerts),
          pushSent: Boolean(profile.push_alerts),
        })
        if (!channel) continue

        try {
          if (channel === "email" || channel === "both") await sendWatchlistAlert(userId, [job], companyName)
          if (channel === "push" || channel === "both") await sendPushNotification(userId, job, "watchlist")
          await recordNotification({ userId, jobId: job.id, alertId: null, channel, notificationType: "watchlist" })
          notifiedUserIds.add(userId)
        } catch {
          // don't let one user's failure block the rest
        }
      }
    }

    // ── Sponsor-match instant push (the visa edge) ─────────────────────────────
    // The moment a fresh sponsor-friendly role lands, ping sponsorship-seekers on
    // instant push — even with no alert built. Gated to sponsor-friendly jobs and
    // a tiny indexed population.
    if (job.sponsors_h1b) {
      const pool = getPostgresPool()
      const { rows: sponsorSeekers } = await pool.query<{ id: string }>(
        `SELECT id FROM profiles
          WHERE needs_sponsorship = true AND push_alerts = true AND alert_frequency = 'instant'
          LIMIT 500`,
      )

      for (const seeker of sponsorSeekers) {
        if (notifiedUserIds.has(seeker.id)) continue
        if (await alreadyNotified(seeker.id, job.id, "alert")) {
          notifiedUserIds.add(seeker.id)
          continue
        }

        let matchScore: number | null = null
        try {
          matchScore = (await scoreJobsForUser(seeker.id, [job.id])).get(job.id)?.overall_score ?? null
        } catch {
          // scoring failure shouldn't suppress the highest-intent push
        }

        const decision = shouldSponsorPush({
          jobSponsorsH1b: job.sponsors_h1b,
          needsSponsorship: true,
          pushAlerts: true,
          frequency: "instant",
          matchScore,
          alreadyNotified: false,
        })
        if (!decision.send) continue

        try {
          await sendPushNotification(seeker.id, job, "sponsor_match")
          await recordNotification({ userId: seeker.id, jobId: job.id, alertId: null, channel: "push", notificationType: "alert" })
          notifiedUserIds.add(seeker.id)
        } catch {
          // don't let one user's failure block the rest
        }
      }
    }
  } catch {
    // best-effort; callers (webhook/cron) must not fail on notification errors
  }
}
