import { NextRequest, NextResponse } from "next/server"
import { Resend } from "resend"
import { logApiUsage } from "@/lib/admin/usage"
import { getEmailCompanyLogoUrl, getHireovenEmailLogoUrl, getHireovenJobDetailUrl, renderEmailExtensionFooter } from "@/lib/email/branding"
import { getRecentJobsFromEmail } from "@/lib/email/identity"
import { requireCronAuth } from "@/lib/env"
import { matchesLocationFilter } from "@/lib/jobs/search-match"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import type { Job, JobAlert } from "@/types"
import type { Pool, PoolClient } from "pg"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const RECENT_JOBS_LOCK_ID = 83319421
const DEFAULT_MIN_SEND_INTERVAL_MINUTES = 60

async function acquireRecentJobsLock(pool: Pool): Promise<PoolClient | null> {
  const client = await pool.connect()
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [RECENT_JOBS_LOCK_ID]
    )
    if (!result.rows[0]?.locked) {
      client.release()
      return null
    }
    return client
  } catch {
    client.release()
    throw new Error("Failed to acquire recent-jobs advisory lock")
  }
}

type UserProfile = {
  id: string
  email: string | null
  full_name: string | null
  email_alerts: boolean
}

type CompanyShape = { name: string; domain: string | null; logo_url: string | null }

type MatchedJobRow = {
  user_id: string
  overall_score: number
  jobs: {
    id: string
    title: string
    apply_url: string
    location: string | null
    is_remote: boolean
    first_detected_at: string
    company: CompanyShape | null
  } | null
}

type FallbackJob = {
  id: string
  title: string
  apply_url: string
  location: string | null
  is_remote: boolean
  first_detected_at: string
  company: CompanyShape | null
}

function matchesAlert(alert: JobAlert, job: Job): boolean {
  if (alert.sponsorship_required && !job.sponsors_h1b && (job.sponsorship_score ?? 0) <= 60) return false
  if (alert.remote_only && !job.is_remote) return false
  if (alert.seniority_levels?.length && job.seniority_level && !alert.seniority_levels.includes(job.seniority_level)) return false
  if (alert.employment_types?.length && job.employment_type && !alert.employment_types.includes(job.employment_type)) return false
  if (alert.company_ids?.length && !alert.company_ids.includes(job.company_id)) return false
  if (alert.keywords?.length) {
    const haystack = `${job.title} ${job.normalized_title ?? ""} ${(job.skills ?? []).join(" ")}`.toLowerCase()
    if (!alert.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) return false
  }
  if (alert.locations?.length) {
    if (!alert.locations.some((entry) => matchesLocationFilter(job.location, entry, { isRemote: job.is_remote }))) {
      return false
    }
  }
  return true
}

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://hireoven.com"
}

function htmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatFreshness(timestamp: string) {
  const diffMinutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
  )

  if (diffMinutes < 60) return `${diffMinutes} min ago`
  const hours = Math.floor(diffMinutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatLocation(location: string | null, isRemote: boolean) {
  if (isRemote && location) return `${location} · Remote`
  if (isRemote) return "Remote"
  return location ?? "Location not listed"
}

function renderJobRows(
  jobs: Array<{
    id: string
    title: string
    apply_url: string
    location: string | null
    is_remote: boolean
    first_detected_at: string
    company: CompanyShape | null
    score?: number
  }>
) {
  return jobs
    .map((job) => {
      const scoreBadge =
        typeof job.score === "number"
          ? `<span style="display:inline-block;margin-top:8px;padding:4px 8px;border-radius:999px;border:1px solid #bae6fd;background:#f0f9ff;color:#0369a1;font-size:11px;font-weight:700;">${job.score}% match</span>`
          : ""

      const logoSrc = getEmailCompanyLogoUrl(job.company?.domain, job.company?.logo_url)
      const logoCell = logoSrc
        ? `<td width="48" valign="top" style="padding:16px 12px 16px 0;width:48px;">
             <img src="${htmlEscape(logoSrc)}" width="44" height="44" alt=""
                  style="display:block;width:44px;height:44px;border-radius:9px;border:1px solid #e2e8f0;background:#fff;object-fit:contain;" />
           </td>`
        : ""

      const href = getHireovenJobDetailUrl(job.id)
      return `
      <tr>
        ${logoCell}
        <td style="padding:16px 0;border-bottom:1px solid #eef2f7;">
          <a href="${htmlEscape(href)}" style="font-size:16px;font-weight:700;color:#0369A1;text-decoration:none;">
            ${htmlEscape(job.title)}
          </a>
          <div style="font-size:13px;color:#64748b;margin-top:4px;">
            ${htmlEscape(job.company?.name ?? "Hireoven company")} · ${htmlEscape(formatLocation(job.location, job.is_remote))}
          </div>
          <div style="font-size:12px;color:#94a3b8;margin-top:6px;">
            Posted ${htmlEscape(formatFreshness(job.first_detected_at))}
          </div>
          ${scoreBadge}
        </td>
      </tr>
      `
    })
    .join("")
}

function buildEmail({
  firstName,
  title,
  subtitle,
  jobsTableRows,
  ctaLabel,
}: {
  firstName: string
  title: string
  subtitle: string
  jobsTableRows: string
  ctaLabel: string
}) {
  const baseUrl = getBaseUrl()

  const hireovenLogo = getHireovenEmailLogoUrl("wordmark")

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f9ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#f5f9ff;">
    <tr><td align="center">
      <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #dbeafe;border-radius:18px;overflow:hidden;">
        <tr>
          <td style="padding:28px 30px;background:linear-gradient(135deg,#0369a1 0%,#0ea5e9 100%);">
            <img src="${hireovenLogo}" alt="Hireoven" height="28"
                 style="display:block;height:28px;width:auto;border:0;outline:none;text-decoration:none;" />
            <div style="margin-top:14px;font-size:28px;line-height:1.2;font-weight:800;color:#ffffff;">${htmlEscape(title)}</div>
            <div style="margin-top:10px;font-size:15px;line-height:1.5;color:#e0f2fe;">${htmlEscape(subtitle)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 30px;">
            <p style="margin:0 0 18px;font-size:15px;color:#334155;">Hi ${htmlEscape(firstName)},</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${jobsTableRows}
            </table>
            <div style="margin-top:26px;text-align:center;">
              <a href="${baseUrl}/dashboard/matches" style="display:inline-block;background:#0369A1;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:700;">
                ${htmlEscape(ctaLabel)}
              </a>
            </div>
          </td>
        </tr>

        <!-- Chrome extension footer -->
        ${renderEmailExtensionFooter()}

        <tr>
          <td style="padding:18px 30px;background:#f8fafc;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
              You're receiving recent jobs updates from Hireoven.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function getSegment(searchParams: URLSearchParams) {
  const segment = searchParams.get("segment")
  if (segment === "with-resume" || segment === "without-resume" || segment === "all") {
    return segment
  }
  return "all"
}

function firstNameOf(fullName: string | null) {
  return fullName?.trim().split(/\s+/)[0] || "there"
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!resend) {
    return NextResponse.json({ skipped: true, reason: "RESEND_API_KEY not configured" })
  }

  const segment = getSegment(request.nextUrl.searchParams)
  const withResumeWindowHours = Number(request.nextUrl.searchParams.get("withResumeHours") ?? "6")
  const minSendIntervalMinutes = Number(
    request.nextUrl.searchParams.get("minSendIntervalMinutes") ?? String(DEFAULT_MIN_SEND_INTERVAL_MINUTES)
  )
  const withResumeSince = new Date(
    Date.now() - Math.max(1, withResumeWindowHours) * 3_600_000
  ).toISOString()
  const endOfDaySince = new Date(Date.now() - 24 * 3_600_000).toISOString()

  const pool = getPostgresPool()
  const lockClient = await acquireRecentJobsLock(pool)
  if (!lockClient) {
    return NextResponse.json({ skipped: true, reason: "recent-jobs run already in progress" })
  }

  try {
    const usersResult = await pool.query<UserProfile>(
      `SELECT id, email, full_name, email_alerts
       FROM profiles
       WHERE email_alerts = true
         AND email IS NOT NULL`
    )
    const users = usersResult.rows
    if (!users.length) return NextResponse.json({ sent: 0, skipped: "No eligible users" })

    const userIds = users.map((user) => user.id)
    const resumeRowsResult = await pool.query<{ user_id: string | null }>(
      `SELECT DISTINCT user_id
       FROM resumes
       WHERE user_id = ANY($1::uuid[])`,
      [userIds]
    )

    const usersWithResume = new Set(
      (resumeRowsResult.rows as Array<{ user_id: string | null }>)
        .map((row) => row.user_id)
        .filter((value): value is string => Boolean(value))
    )

    const resumeRecipients =
      segment === "without-resume"
        ? []
        : users.filter((user) => usersWithResume.has(user.id))
    const noResumeRecipients =
      segment === "with-resume"
        ? []
        : users.filter((user) => !usersWithResume.has(user.id))

    let sentWithResume = 0
    let sentWithoutResume = 0
    let errors = 0
    let suppressedDupes = 0
    let suppressedByCooldown = 0

  // Per-(user, job) email-send ledger keyed off alert_notifications.
  // Without this, frequent cron ticks can re-email the same top jobs
  // from the current window until the job ages out.
  async function loadAlreadyEmailed(
    userIds: string[],
    jobIds: string[]
  ): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>()
    if (userIds.length === 0 || jobIds.length === 0) return out
    const { rows: sent } = await pool.query<{ user_id: string; job_id: string }>(
      `SELECT user_id, job_id FROM alert_notifications
        WHERE channel = 'email'
          AND user_id = ANY($1::uuid[])
          AND job_id = ANY($2::uuid[])
          AND sent_at > now() - interval '14 days'`,
      [userIds, jobIds]
    )
    for (const r of sent) {
      const set = out.get(r.user_id) ?? new Set<string>()
      set.add(r.job_id)
      out.set(r.user_id, set)
    }
    return out
  }
  async function loadUsersEmailedRecently(
    userIds: string[],
    minMinutes: number
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set<string>()
    const windowMinutes = Math.max(1, Math.floor(minMinutes))
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT DISTINCT user_id
       FROM alert_notifications
       WHERE channel = 'email'
         AND user_id = ANY($1::uuid[])
         AND sent_at > now() - ($2::int * interval '1 minute')`,
      [userIds, windowMinutes]
    )
    return new Set(rows.map((row) => row.user_id))
  }
  async function recordEmailSends(userId: string, jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return
    await pool.query(
      `INSERT INTO alert_notifications (user_id, job_id, channel)
       SELECT $1::uuid, ids.job_id, 'email'
       FROM unnest($2::uuid[]) AS ids(job_id)
       WHERE NOT EXISTS (
         SELECT 1
         FROM alert_notifications an
         WHERE an.user_id = $1::uuid
           AND an.job_id = ids.job_id
           AND an.channel = 'email'
       )`,
      [userId, jobIds]
    )
  }

  // Hoisted: both segments need to check user-alert existence as the explicit
  // opt-in signal. Fetch alerts for ALL eligible users (with + without resume).
  const alertsResult = await pool.query<JobAlert & { user_id: string }>(
    `SELECT * FROM job_alerts WHERE user_id = ANY($1::uuid[]) AND is_active = true`,
    [users.map((user) => user.id)]
  )
  const alertsByUser = new Map<string, JobAlert[]>()
  for (const row of alertsResult.rows) {
    const list = alertsByUser.get(row.user_id) ?? []
    list.push(row)
    alertsByUser.set(row.user_id, list)
  }

  const recentlyEmailedResumeUsers = await loadUsersEmailedRecently(
    resumeRecipients.map((user) => user.id),
    minSendIntervalMinutes
  )
  const recentlyEmailedNoResumeUsers = await loadUsersEmailedRecently(
    noResumeRecipients.map((user) => user.id),
    minSendIntervalMinutes
  )

  if (resumeRecipients.length) {
    const matchedRowsResult = await pool.query<
      {
        user_id: string
        overall_score: number
        id: string
        title: string
        apply_url: string
        location: string | null
        is_remote: boolean
        first_detected_at: string
        company_name: string | null
        company_domain: string | null
        company_logo_url: string | null
        job_full: Job
      }
    >(
      `SELECT
         jms.user_id,
         jms.overall_score,
         jobs.id,
         jobs.title,
         jobs.apply_url,
         jobs.location,
         jobs.is_remote,
         jobs.first_detected_at,
         companies.name     AS company_name,
         companies.domain   AS company_domain,
         companies.logo_url AS company_logo_url,
         to_jsonb(jobs.*)   AS job_full
       FROM job_match_scores jms
       INNER JOIN jobs ON jobs.id = jms.job_id
       LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE jms.user_id = ANY($1::uuid[])
         AND jms.overall_score >= 75
         AND jobs.first_detected_at >= $2
         AND jobs.is_active = true
         AND ${sqlJobLocatedInUsa("jobs")}
       -- Freshest first per user-facing convention. Score is the threshold
       -- (>=75), not the primary sort key.
       ORDER BY jobs.first_detected_at DESC, jms.overall_score DESC
       LIMIT 1000`,
      [resumeRecipients.map((user) => user.id), withResumeSince]
    )

    type EnrichedMatchedRow = MatchedJobRow & { jobFull?: Job }
    const byUser = new Map<string, Array<EnrichedMatchedRow>>()
    const allCandidateJobIds = new Set<string>()
    for (const row of matchedRowsResult.rows) {
      const company = row.company_name
        ? { name: row.company_name, domain: row.company_domain, logo_url: row.company_logo_url }
        : null
      const normalized: EnrichedMatchedRow = {
        user_id: row.user_id,
        overall_score: row.overall_score,
        jobs: {
          id: row.id,
          title: row.title,
          apply_url: row.apply_url,
          location: row.location,
          is_remote: row.is_remote,
          first_detected_at: row.first_detected_at,
          company,
        },
        jobFull: row.job_full,
      }
      const current = byUser.get(row.user_id) ?? []
      current.push(normalized)
      byUser.set(normalized.user_id, current)
      allCandidateJobIds.add(row.id)
    }

    const alreadyEmailed = await loadAlreadyEmailed(
      resumeRecipients.map((u) => u.id),
      Array.from(allCandidateJobIds)
    )

    for (const user of resumeRecipients) {
      if (recentlyEmailedResumeUsers.has(user.id)) {
        suppressedByCooldown += 1
        continue
      }
      const rows = byUser.get(user.id) ?? []
      if (!rows.length) continue

      // Require an explicit opt-in: the user must have at least one active
      // job_alert. Without that, skip them entirely — we no longer fall
      // through to a "match-score-only" blast.
      const userAlerts = alertsByUser.get(user.id) ?? []
      if (userAlerts.length === 0) continue
      const sentSet = alreadyEmailed.get(user.id) ?? new Set<string>()
      const filtered = rows.filter((row) => {
        if (!row.jobFull) return false
        if (sentSet.has(row.jobs!.id)) { suppressedDupes += 1; return false }
        return userAlerts.some((alert) => matchesAlert(alert, row.jobFull as Job))
      })

      const topJobs = filtered
        .filter((row) => row.jobs)
        .slice(0, 5)
        .map((row) => ({
          ...row.jobs!,
          score: row.overall_score,
        }))

      if (!topJobs.length) continue

      try {
        await resend.emails.send({
          from: getRecentJobsFromEmail(),
          to: [user.email!],
          subject: `${topJobs.length} high-match jobs just added for you`,
          html: buildEmail({
            firstName: firstNameOf(user.full_name),
            title: "Fresh high-match jobs",
            subtitle: "These new roles are 75%+ matches for your resume.",
            jobsTableRows: renderJobRows(topJobs),
            ctaLabel: "View more high-match jobs",
          }),
        })
        sentWithResume += 1
        try {
          await recordEmailSends(user.id, topJobs.map((j) => j.id))
        } catch (err) {
          errors += 1
          console.warn("[recent-jobs] failed to record send", err)
        }
        await logApiUsage({ service: "resend", operation: "recent-jobs-with-resume", tokens_used: null, cost_usd: 0 })
      } catch {
        errors += 1
      }
    }
  }

  if (noResumeRecipients.length) {
    const fallbackJobsResult = await pool.query<
      {
        id: string
        title: string
        apply_url: string
        location: string | null
        is_remote: boolean
        first_detected_at: string
        company_name: string | null
        company_domain: string | null
        company_logo_url: string | null
      }
    >(
      `SELECT
         jobs.id,
         jobs.title,
         jobs.apply_url,
         jobs.location,
         jobs.is_remote,
         jobs.first_detected_at,
         companies.name     AS company_name,
         companies.domain   AS company_domain,
         companies.logo_url AS company_logo_url
       FROM jobs
       LEFT JOIN companies ON companies.id = jobs.company_id
       WHERE jobs.is_active = true
         AND ${sqlJobLocatedInUsa("jobs")}
         AND jobs.first_detected_at >= $1
       ORDER BY jobs.first_detected_at DESC
       LIMIT 5`,
      [endOfDaySince]
    )

    const fallbackJobs = fallbackJobsResult.rows.map<FallbackJob>((row) => ({
      id: row.id,
      title: row.title,
      apply_url: row.apply_url,
      location: row.location,
      is_remote: row.is_remote,
      first_detected_at: row.first_detected_at,
      company: row.company_name
        ? { name: row.company_name, domain: row.company_domain, logo_url: row.company_logo_url }
        : null,
    }))
    if (fallbackJobs.length) {
      const alreadyEmailedNoResume = await loadAlreadyEmailed(
        noResumeRecipients.map((u) => u.id),
        fallbackJobs.map((j) => j.id)
      )
      for (const user of noResumeRecipients) {
        if (recentlyEmailedNoResumeUsers.has(user.id)) {
          suppressedByCooldown += 1
          continue
        }
        // Same opt-in rule: only send if the user has at least one active
        // job_alert. Without that signal, a resume-less account gets no email.
        const userAlerts = alertsByUser.get(user.id) ?? []
        if (userAlerts.length === 0) continue
        const sentSet = alreadyEmailedNoResume.get(user.id) ?? new Set<string>()
        // Filter the fallback list by the user's alerts so we don't ship
        // off-target jobs to a careful opt-in.
        const userJobs = fallbackJobs.filter((job) => {
          if (sentSet.has(job.id)) { suppressedDupes += 1; return false }
          return userAlerts.some((alert) => matchesAlert(alert, job as unknown as Job))
        })
        if (userJobs.length === 0) continue
        try {
          await resend.emails.send({
            from: getRecentJobsFromEmail(),
            to: [user.email!],
            subject: `Today's ${userJobs.length} fresh jobs on Hireoven`,
            html: buildEmail({
              firstName: firstNameOf(user.full_name),
              title: "Today's fresh jobs",
              subtitle:
                "Matches against your saved alerts. Upload your resume to unlock 75%+ match scores.",
              jobsTableRows: renderJobRows(userJobs),
              ctaLabel: "View more in Hireoven",
            }),
          })
          sentWithoutResume += 1
          try {
            await recordEmailSends(user.id, userJobs.map((j) => j.id))
          } catch (err) {
            errors += 1
            console.warn("[recent-jobs] failed to record send", err)
          }
          await logApiUsage({ service: "resend", operation: "recent-jobs-without-resume", tokens_used: null, cost_usd: 0 })
        } catch {
          errors += 1
        }
      }
    }
  }

  return NextResponse.json({
    segment,
    sentWithResume,
    sentWithoutResume,
    suppressedDupes,
    suppressedByCooldown,
    errors,
    withResumeWindowHours,
    minSendIntervalMinutes: Math.max(1, Math.floor(minSendIntervalMinutes)),
  })
  } finally {
    try {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [RECENT_JOBS_LOCK_ID])
    } catch (error) {
      console.warn("[recent-jobs] failed to release advisory lock", error)
    }
    lockClient.release()
  }
}
