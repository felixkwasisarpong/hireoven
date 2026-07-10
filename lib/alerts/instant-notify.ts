/**
 * Instant-notification pipeline (shared, batch-aware).
 *
 * Runs a *batch* of newly-detected jobs through alert + watchlist matching and
 * the sponsor-match push, for users on "instant" frequency. Notifications come
 * together: when a harvest/crawl lands many matching jobs at once, each user
 * gets ONE email (multi-job digest) and ONE summary push — not a ping per job.
 *
 * Extracted from the Supabase webhook so the harvester + crawler event triggers
 * and the cron fallback all share it. Idempotent: each (user, job, type) is
 * recorded in alert_notifications and re-checked before sending, so reprocessing
 * an overlapping batch/window can't double-notify. (Single-threaded callers ⇒ no
 * TOCTOU race.)
 */
import {
  combineChannels,
  sendBatchPushNotification,
  sendEmailAlert,
  sendWatchlistAlert,
} from "@/lib/alerts/sender"
import { notificationFreshnessDate } from "@/lib/alerts/job-freshness"
import { matchJobToAlerts, matchJobToWatchlists } from "@/lib/alerts/matcher"
import { instantNotifyWindowMinutes, isWithinInstantNotifyWindow } from "@/lib/alerts/instant-notify-window"
import { shouldSponsorPush } from "@/lib/alerts/sponsor-match"
import { scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import type { AlertFrequency, Job, NotificationChannel, NotificationType } from "@/types"

const INSTANT_EMAIL_MIN_MATCH_SCORE = 75

// Accumulation window: after an alert notifies a user, hold further matches for
// this many minutes and roll them into the next send — so a user gets at most
// one alert email per window instead of a ping on every 5-min sweep / real-time
// batch. Matches arriving mid-window stay un-recorded, so they accumulate.
// Must be < the lookback window (instantNotifyWindowMinutes) so held-back jobs
// are still eligible when the window elapses. Env-overridable.
const ALERT_ACCUMULATE_MS =
  Math.max(0, Number(process.env.ALERT_ACCUMULATE_MINUTES ?? "30")) * 60_000

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

async function alreadyNotified(userId: string, jobId: string, type: NotificationType): Promise<boolean> {
  const pool = getPostgresPool()
  const { rows } = await pool.query(
    `SELECT 1 FROM alert_notifications
      WHERE user_id = $1 AND job_id = $2 AND notification_type = $3 LIMIT 1`,
    [userId, jobId, type],
  )
  return rows.length > 0
}

async function recordNotification(
  userId: string,
  jobId: string,
  channel: NotificationChannel,
  notificationType: NotificationType,
  alertId: string | null = null,
) {
  const pool = getPostgresPool()
  try {
    await pool.query(
      `INSERT INTO alert_notifications (user_id, job_id, alert_id, channel, notification_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, job_id, notification_type) DO NOTHING`,
      [userId, jobId, alertId, channel, notificationType],
    )
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error
  }
}

/**
 * Match a batch of jobs and fire instant notifications for instant-frequency
 * users, grouped per user. Safe to call repeatedly for the same jobs.
 */
export async function processNotifications(jobs: Job[]): Promise<void> {
  const windowMinutes = instantNotifyWindowMinutes()
  const freshJobs = jobs.filter((job) =>
    isWithinInstantNotifyWindow(notificationFreshnessDate(job), { windowMinutes })
  )
  if (freshJobs.length === 0) return
  try {
    // (userId -> jobIds notified this run) so a user the alert pass reached
    // isn't also hit by the watchlist / sponsor pass for the same job.
    const notified = new Map<string, Set<string>>()
    const markNotified = (userId: string, jobId: string) => {
      const set = notified.get(userId) ?? new Set<string>()
      set.add(jobId)
      notified.set(userId, set)
    }
    const wasNotified = (userId: string, jobId: string) => notified.get(userId)?.has(jobId) ?? false

    // ── 1. Alert matches, grouped per user ────────────────────────────────────
    const alertsByUser = new Map<string, { name: string; alertIds: Set<string>; jobs: Map<string, Job> }>()
    for (const job of freshJobs) {
      for (const alert of await matchJobToAlerts(job)) {
        const entry = alertsByUser.get(alert.user_id) ?? { name: alert.name ?? "Job alert", alertIds: new Set(), jobs: new Map() }
        entry.alertIds.add(alert.id)
        entry.jobs.set(job.id, job)
        alertsByUser.set(alert.user_id, entry)
      }
    }

    for (const [userId, entry] of alertsByUser) {
      const profile = await fetchProfileChannels(userId)
      if (!profile || profile.alert_frequency !== "instant") continue
      if (!profile.email_alerts && !profile.push_alerts) continue

      // Accumulation cooldown: if any of this user's matched alerts fired within
      // the window, skip now — the fresh jobs stay un-recorded and roll into the
      // next send once the window elapses (batching, not per-sweep spam).
      if (ALERT_ACCUMULATE_MS > 0 && entry.alertIds.size > 0) {
        const { rows } = await getPostgresPool().query<{ last: string | null }>(
          `SELECT max(last_triggered_at) AS last FROM job_alerts WHERE id = ANY($1::uuid[])`,
          [[...entry.alertIds]],
        )
        const lastMs = rows[0]?.last ? new Date(rows[0].last).getTime() : 0
        if (lastMs && Date.now() - lastMs < ALERT_ACCUMULATE_MS) continue
      }

      const fresh: Job[] = []
      for (const job of entry.jobs.values()) {
        if (!(await alreadyNotified(userId, job.id, "alert"))) fresh.push(job)
      }
      if (fresh.length === 0) continue

      // Email is score-gated; push is not (matches the prior per-job behaviour).
      let emailJobs = fresh
      if (profile.email_alerts) {
        try {
          const scores = await scoreJobsForUser(userId, fresh.map((j) => j.id))
          emailJobs = fresh.filter((j) => {
            const s = scores.get(j.id)
            return !s || s.overall_score >= INSTANT_EMAIL_MIN_MATCH_SCORE
          })
        } catch {
          // keep all on scoring failure
        }
      }

      const emailSent = Boolean(profile.email_alerts) && emailJobs.length > 0
      const channel = combineChannels({ emailSent, pushSent: Boolean(profile.push_alerts) })
      if (!channel) continue

      try {
        if (emailSent) await sendEmailAlert(userId, emailJobs, entry.name)
        if (profile.push_alerts) await sendBatchPushNotification(userId, fresh, "alert")
        for (const job of fresh) {
          await recordNotification(userId, job.id, channel, "alert")
          markNotified(userId, job.id)
        }
        // Stamp last_triggered_at on every alert that matched this run
        if (entry.alertIds.size > 0) {
          const pool = getPostgresPool()
          await pool.query(
            `UPDATE job_alerts SET last_triggered_at = now() WHERE id = ANY($1::uuid[])`,
            [[...entry.alertIds]],
          )
        }
      } catch {
        // per-user isolation
      }
    }

    // ── 2. Watchlist matches, grouped per (user, company) ─────────────────────
    const watchByUser = new Map<string, Map<string, Job[]>>() // userId -> companyId -> jobs
    const companyIds = new Set<string>()
    for (const job of freshJobs) {
      const userIds = await matchJobToWatchlists(job)
      for (const userId of userIds) {
        if (wasNotified(userId, job.id)) continue
        let byCompany = watchByUser.get(userId)
        if (!byCompany) {
          byCompany = new Map()
          watchByUser.set(userId, byCompany)
        }
        const list = byCompany.get(job.company_id) ?? []
        list.push(job)
        byCompany.set(job.company_id, list)
        companyIds.add(job.company_id)
      }
    }

    const companyNames = new Map<string, string>()
    if (companyIds.size > 0) {
      const pool = getPostgresPool()
      const { rows } = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM companies WHERE id = ANY($1::uuid[])`,
        [[...companyIds]],
      )
      for (const r of rows) companyNames.set(r.id, r.name)
    }

    for (const [userId, byCompany] of watchByUser) {
      const profile = await fetchProfileChannels(userId)
      if (!profile || profile.alert_frequency !== "instant") continue
      const channel = combineChannels({ emailSent: Boolean(profile.email_alerts), pushSent: Boolean(profile.push_alerts) })
      if (!channel) continue

      for (const [companyId, list] of byCompany) {
        const fresh: Job[] = []
        for (const job of list) {
          if (wasNotified(userId, job.id)) continue
          if (!(await alreadyNotified(userId, job.id, "watchlist"))) fresh.push(job)
        }
        if (fresh.length === 0) continue
        const companyName = companyNames.get(companyId) ?? "Tracked company"

        try {
          if (channel === "email" || channel === "both") await sendWatchlistAlert(userId, fresh, companyName)
          if (channel === "push" || channel === "both") await sendBatchPushNotification(userId, fresh, "watchlist")
          for (const job of fresh) {
            await recordNotification(userId, job.id, channel, "watchlist")
            markNotified(userId, job.id)
          }
        } catch {
          // per-user isolation
        }
      }
    }

    // ── 3. Sponsor-match push, grouped per seeker ─────────────────────────────
    const sponsorJobs = freshJobs.filter((j) => j.sponsors_h1b)
    if (sponsorJobs.length > 0) {
      const pool = getPostgresPool()
      const { rows: seekers } = await pool.query<{ id: string }>(
        `SELECT id FROM profiles
          WHERE needs_sponsorship = true AND push_alerts = true AND alert_frequency = 'instant'
          LIMIT 500`,
      )

      for (const seeker of seekers) {
        const fresh: Job[] = []
        for (const job of sponsorJobs) {
          if (wasNotified(seeker.id, job.id)) continue
          if (await alreadyNotified(seeker.id, job.id, "alert")) continue
          fresh.push(job)
        }
        if (fresh.length === 0) continue

        let scores: Map<string, { overall_score: number }> | null = null
        try {
          scores = await scoreJobsForUser(seeker.id, fresh.map((j) => j.id))
        } catch {
          // no scores → shouldSponsorPush still sends (highest-intent users)
        }

        const qualifying = fresh.filter((job) =>
          shouldSponsorPush({
            jobSponsorsH1b: job.sponsors_h1b,
            needsSponsorship: true,
            pushAlerts: true,
            frequency: "instant",
            matchScore: scores?.get(job.id)?.overall_score ?? null,
            alreadyNotified: false,
          }).send,
        )
        if (qualifying.length === 0) continue

        try {
          await sendBatchPushNotification(seeker.id, qualifying, "sponsor_match")
          for (const job of qualifying) {
            await recordNotification(seeker.id, job.id, "push", "alert")
            markNotified(seeker.id, job.id)
          }
        } catch {
          // per-user isolation
        }
      }
    }
  } catch {
    // best-effort; callers must not fail on notification errors
  }
}
