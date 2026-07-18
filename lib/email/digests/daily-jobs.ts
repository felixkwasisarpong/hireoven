/**
 * Daily "fresh jobs posted overnight" broadcast to marketing subscribers.
 *
 * Reuses the stored Daily Report for the headline numbers and a live pull of the
 * last 24h of listings for the job list, then fans out through sendManaged() so
 * every address gets idempotency (dedupe per day), send-time suppression, and an
 * RFC 8058 one-click unsubscribe.
 */

import type { Pool } from "pg"
import { sendManaged } from "@/lib/email/provider"
import { renderDailyJobsEmail } from "@/lib/email/templates/daily-jobs"
import {
  buildMarketingUnsubscribeUrl,
  listActiveMarketingSubscribers,
} from "@/lib/marketing/subscribers"
import {
  buildDailyReport,
  getLatestReport,
  getStoredReport,
  toReportDate,
  type DailyReport,
} from "@/lib/grow/daily-report"
import { sqlPublishedJob } from "@/lib/jobs/publication"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { freshnessLabel } from "@/lib/jobs/format"

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com").replace(/\/$/, "")

function dateLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}

interface FreshJobRow {
  id: string
  title: string
  company: string | null
  location: string | null
  is_remote: boolean | null
  first_detected_at: string | null
}

/** The freshest listings from the last 24h, for the email's job list. */
async function getFreshJobsForEmail(pool: Pool, limit: number): Promise<FreshJobRow[]> {
  const { rows } = await pool.query<FreshJobRow>(
    `SELECT j.id, j.title, j.location, j.is_remote, j.first_detected_at,
            c.name AS company
       FROM jobs j
       JOIN companies c ON c.id = j.company_id
      WHERE j.is_active = true
        AND ${sqlPublishedJob("j")}
        AND ${sqlJobLocatedInUsa("j", { companyAlias: "c" })}
        AND j.first_detected_at >= now() - interval '24 hours'
      ORDER BY j.first_detected_at DESC NULLS LAST
      LIMIT $1`,
    [limit],
  )
  return rows
}

async function resolveReport(pool: Pool, date?: string): Promise<DailyReport | null> {
  if (date) {
    return (await getStoredReport(pool, toReportDate(date))) ?? (await buildDailyReport(pool, toReportDate(date)))
  }
  // No date given: prefer the latest stored snapshot; fall back to computing
  // today's on the fly so a missing cron run doesn't block the send.
  return (await getLatestReport(pool)) ?? (await buildDailyReport(pool, toReportDate()))
}

export interface DailyJobsSendResult {
  date: string
  recipients: number
  newJobs: number
  results: Record<string, number>
  skippedReason?: "no_report" | "no_new_jobs" | "no_subscribers"
}

/**
 * Send the daily fresh-jobs email to every active marketing subscriber.
 * Idempotent per (day, address) via the dedupe key, so a re-run the same day
 * won't double-send.
 */
export async function sendDailyJobsDigest(
  pool: Pool,
  opts: { date?: string } = {},
): Promise<DailyJobsSendResult> {
  const report = await resolveReport(pool, opts.date)
  if (!report) {
    return { date: opts.date ?? toReportDate(), recipients: 0, newJobs: 0, results: {}, skippedReason: "no_report" }
  }

  // Don't mail an empty overnight — a "0 fresh jobs" blast erodes trust.
  if (report.totals.newJobs <= 0) {
    return { date: report.date, recipients: 0, newJobs: 0, results: {}, skippedReason: "no_new_jobs" }
  }

  const subscribers = await listActiveMarketingSubscribers()
  if (subscribers.length === 0) {
    return { date: report.date, recipients: 0, newJobs: report.totals.newJobs, results: {}, skippedReason: "no_subscribers" }
  }

  const freshJobs = await getFreshJobsForEmail(pool, 8)
  const reportUrl = `${APP_URL}/report`
  const browseUrl = `${APP_URL}/jobs/browse`
  const label = dateLabel(report.date)

  const results: Record<string, number> = {}
  for (const sub of subscribers) {
    const unsubscribeUrl = buildMarketingUnsubscribeUrl(sub.unsubscribeToken)
    const rendered = renderDailyJobsEmail({
      dateLabel: label,
      totals: {
        newJobs: report.totals.newJobs,
        aiJobs: report.totals.aiJobs,
        remoteJobs: report.totals.remoteJobs,
        sponsorCompanies: report.totals.sponsorCompanies,
      },
      jobs: freshJobs.map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        isRemote: Boolean(j.is_remote),
        fresh: freshnessLabel(j.first_detected_at),
      })),
      reportUrl,
      browseUrl,
      unsubscribeUrl,
    })

    const r = await sendManaged({
      userId: null,
      emailType: "daily_jobs",
      dedupeKey: `daily-jobs:${report.date}:${sub.email}`,
      toEmail: sub.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      unsubscribeUrl,
    })
    results[r] = (results[r] ?? 0) + 1
  }

  return { date: report.date, recipients: subscribers.length, newJobs: report.totals.newJobs, results }
}
