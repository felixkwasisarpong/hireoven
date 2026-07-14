/**
 * Instant-notification pipeline (shared, batch-aware).
 *
 * Runs a *batch* of newly-detected jobs through alert matching, watchlist push,
 * and sponsor-match push for users on "instant" frequency. Saved alerts are the
 * only email path; watchlist updates stay out of email to avoid a second mail
 * type for the same harvest window.
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
} from "@/lib/alerts/sender"
import { notificationFreshnessDate } from "@/lib/alerts/job-freshness"
import { matchJobToAlerts, matchJobToWatchlists } from "@/lib/alerts/matcher"
import { instantNotifyWindowMinutes, isWithinInstantNotifyWindow } from "@/lib/alerts/instant-notify-window"
import { shouldSponsorPush } from "@/lib/alerts/sponsor-match"
import { scoreJobsForUser } from "@/lib/matching/batch-scorer"
import { getPostgresPool } from "@/lib/postgres/server"
import type { AlertFrequency, Job, NotificationChannel, NotificationType } from "@/types"

// Minimum resume-match score for a job to be included in an instant alert email
// (env-tunable). Raised 75 -> 85 for higher-quality, fewer emails.
const INSTANT_EMAIL_MIN_MATCH_SCORE = (() => {
  const n = Number(process.env.INSTANT_EMAIL_MIN_MATCH_SCORE ?? "85")
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 85
})()

// Accumulation window: after an alert notifies a user, hold further matches for
// this many minutes and roll them into the next send — so a user gets at most
// one alert email per window instead of a ping on every 5-min sweep / real-time
// batch. Matches arriving mid-window stay un-recorded, so they accumulate.
// Must be < the lookback window (instantNotifyWindowMinutes) so held-back jobs
// are still eligible when the window elapses. Env-overridable.
const ALERT_ACCUMULATE_MS =
  Math.max(0, Number(process.env.ALERT_ACCUMULATE_MINUTES ?? "60")) * 60_000

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

async function existingNotificationChannel(
  userId: string,
  jobId: string,
  type: NotificationType,
): Promise<NotificationChannel | null> {
  const pool = getPostgresPool()
  const { rows } = await pool.query<{ channel: NotificationChannel | null }>(
    `SELECT channel FROM alert_notifications
      WHERE user_id = $1 AND job_id = $2 AND notification_type = $3 LIMIT 1`,
    [userId, jobId, type],
  )
  return rows[0]?.channel ?? null
}

function channelHasEmail(channel: NotificationChannel | null): boolean {
  return channel === "email" || channel === "both"
}

function channelHasPush(channel: NotificationChannel | null): boolean {
  return channel === "push" || channel === "both"
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
      // The arbiter index (uniq_alert_notifications_user_job_type) is PARTIAL,
      // so the ON CONFLICT target MUST repeat its predicate — without it
      // Postgres raises 42P10 ("no unique or exclusion constraint matching")
      // on EVERY insert, the row is never recorded, last_triggered_at never
      // stamps, and the same job re-emails on every 5-minute sweep for the
      // whole lookback window (observed live: ModernaTX ×3, GEICO ×4+ on
      // 2026-07-13).
      `INSERT INTO alert_notifications (user_id, job_id, alert_id, channel, notification_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, job_id, notification_type)
         WHERE user_id IS NOT NULL AND job_id IS NOT NULL
       DO UPDATE SET
         channel = CASE
           WHEN alert_notifications.channel = EXCLUDED.channel THEN alert_notifications.channel
           WHEN alert_notifications.channel IS NULL THEN EXCLUDED.channel
           WHEN EXCLUDED.channel IS NULL THEN alert_notifications.channel
           ELSE 'both'
         END,
         alert_id = COALESCE(alert_notifications.alert_id, EXCLUDED.alert_id),
         sent_at = now()`,
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
  let freshJobs = jobs.filter((job) =>
    isWithinInstantNotifyWindow(notificationFreshnessDate(job), { windowMinutes })
  )
  if (freshJobs.length === 0) return
  try {
    // Company gate: aggregator ingests (Adzuna etc.) still insert jobs under
    // inactive placeholder companies flagged duplicate_of — usually stale
    // copies of roles already harvested under the canonical company. Never
    // alert on them. Lives here (not in the callers' SQL) so the cron sweep,
    // the internal notify-jobs trigger, and any future caller all get it.
    const batchCompanyIds = [...new Set(freshJobs.map((j) => j.company_id))]
    const { rows: eligibleCompanies } = await getPostgresPool().query<{ id: string }>(
      `SELECT id FROM companies
        WHERE id = ANY($1::uuid[])
          AND is_active = true
          AND duplicate_of_company_id IS NULL`,
      [batchCompanyIds],
    )
    const eligible = new Set(eligibleCompanies.map((c) => c.id))
    freshJobs = freshJobs.filter((j) => eligible.has(j.company_id))
    if (freshJobs.length === 0) return

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

      const emailCandidates: Job[] = []
      const pushCandidates: Job[] = []
      for (const job of entry.jobs.values()) {
        const existingChannel = await existingNotificationChannel(userId, job.id, "alert")
        if (!channelHasEmail(existingChannel)) emailCandidates.push(job)
        if (!channelHasPush(existingChannel)) pushCandidates.push(job)
      }
      if (emailCandidates.length === 0 && pushCandidates.length === 0) continue

      // Email is score-gated; push is not. Missing scores do not qualify for
      // email: an empty/low-score accumulation window should send nothing.
      let emailJobs: Job[] = []
      let scores: Awaited<ReturnType<typeof scoreJobsForUser>> | undefined
      if (profile.email_alerts && emailCandidates.length > 0) {
        try {
          scores = await scoreJobsForUser(userId, emailCandidates.map((j) => j.id))
          const scored = scores
          emailJobs = emailCandidates.filter((j) => {
            const s = scored.get(j.id)
            return Boolean(s && s.overall_score >= INSTANT_EMAIL_MIN_MATCH_SCORE)
          })
        } catch (error) {
          console.warn("[instant-notify] alert email scoring failed", {
            userId,
            jobCount: emailCandidates.length,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const emailJobIds = new Set(emailJobs.map((job) => job.id))
      const pushJobs = profile.push_alerts ? pushCandidates : []
      const pushJobIds = new Set(pushJobs.map((job) => job.id))
      let emailSent = false
      let pushSent = false

      try {
        if (profile.email_alerts && emailJobs.length > 0) {
          await sendEmailAlert(userId, emailJobs, entry.name, scores)
          emailSent = true
        }
      } catch (error) {
        console.warn("[instant-notify] alert email failed", {
          userId,
          jobCount: emailJobs.length,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      try {
        if (pushJobs.length > 0) {
          await sendBatchPushNotification(userId, pushJobs, "alert")
          pushSent = true
        }
      } catch (error) {
        console.warn("[instant-notify] alert push failed", {
          userId,
          jobCount: pushJobs.length,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      let recordedAny = false
      try {
        const deliveredJobs = new Map<string, Job>()
        if (emailSent) for (const job of emailJobs) deliveredJobs.set(job.id, job)
        if (pushSent) for (const job of pushJobs) deliveredJobs.set(job.id, job)

        for (const job of deliveredJobs.values()) {
          const channel = combineChannels({
            emailSent: emailSent && emailJobIds.has(job.id),
            pushSent: pushSent && pushJobIds.has(job.id),
          })
          if (!channel) continue
          await recordNotification(userId, job.id, channel, "alert")
          markNotified(userId, job.id)
          recordedAny = true
        }

        // Stamp last_triggered_at only after an email batch was delivered. Push
        // can be immediate without starting the hourly email cooldown.
        if (emailSent && recordedAny && entry.alertIds.size > 0) {
          const pool = getPostgresPool()
          await pool.query(
            `UPDATE job_alerts SET last_triggered_at = now() WHERE id = ANY($1::uuid[])`,
            [[...entry.alertIds]],
          )
        }
      } catch (error) {
        console.warn("[instant-notify] alert notification record failed", {
          userId,
          error: error instanceof Error ? error.message : String(error),
        })
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
      if (!profile.push_alerts) continue

      for (const [companyId, list] of byCompany) {
        const fresh: Job[] = []
        for (const job of list) {
          if (wasNotified(userId, job.id)) continue
          if (!(await alreadyNotified(userId, job.id, "watchlist"))) fresh.push(job)
        }
        if (fresh.length === 0) continue
        const companyName = companyNames.get(companyId) ?? "Tracked company"

        let pushSent = false

        try {
          await sendBatchPushNotification(userId, fresh, "watchlist")
          pushSent = true
        } catch (error) {
          console.warn("[instant-notify] watchlist push failed", {
            userId,
            companyId,
            jobCount: fresh.length,
            error: error instanceof Error ? error.message : String(error),
          })
        }

        const deliveredChannel = combineChannels({ emailSent: false, pushSent })
        if (!deliveredChannel) continue

        try {
          for (const job of fresh) {
            await recordNotification(userId, job.id, deliveredChannel, "watchlist")
            markNotified(userId, job.id)
          }
        } catch (error) {
          console.warn("[instant-notify] watchlist notification record failed", {
            userId,
            companyId,
            error: error instanceof Error ? error.message : String(error),
          })
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
        } catch (error) {
          console.warn("[instant-notify] sponsor-match push failed", {
            userId: seeker.id,
            jobCount: qualifying.length,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  } catch (error) {
    // Best-effort — callers must not fail on notification errors — but NEVER
    // silent: this catch swallowed the 42P10 record failures that re-emailed
    // users every sweep, twice (2026-07-12 and 2026-07-13), with zero trace.
    console.error("[instant-notify] processNotifications failed:", error)
  }
}
