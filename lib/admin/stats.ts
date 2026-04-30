import { startOfDay, startOfWeek, subHours } from "@/lib/admin/time"
import { sqlJobLocatedInUsa } from "@/lib/jobs/usa-job-sql"
import { getPostgresPool } from "@/lib/postgres/server"
import type {
  AlertNotification,
  ApiUsage,
  Company,
  CrawlLog,
  Job,
  NotificationChannel,
  SystemSetting,
} from "@/types"

export type AdminStats = {
  totalCompanies: number
  activeCompanies: number
  totalActiveJobs: number
  jobsToday: number
  jobsThisWeek: number
  totalUsers: number
  usersToday: number
  alertsSentToday: number
  crawlsToday: number
  failedCrawlsToday: number
  averageCrawlDuration: number
}

export type CrawlerStatus = "running" | "idle" | "error"

export type CrawlHealth = {
  lastCrawlRun: string | null
  nextScheduledCrawl: string | null
  crawlerStatus: CrawlerStatus
  failedCrawlsLast24Hours: number
  averageCrawlDuration: number
  companiesWithZeroJobs: number
}

export type APIUsage = {
  claudeCallsToday: number
  estimatedCostUsd: number
  pushNotificationsSent: number
  emailsSent: number
}

export type AdminRealtimePayload = {
  recentCrawlLogs: Array<
    CrawlLog & { company: Pick<Company, "id" | "name" | "ats_type"> | null }
  >
  recentJobs: Array<
    Job & { company: Pick<Company, "id" | "name" | "ats_type" | "logo_url"> | null }
  >
  settings: Record<string, unknown>
}

export type AdminOverviewPayload = {
  stats: AdminStats
  crawlHealth: CrawlHealth
  apiUsage: APIUsage
  realtime: AdminRealtimePayload
}

export type AdminUserSummary = {
  id: string
  email: string | null
  name: string | null
  joinedAt: string | null
  lastActiveAt: string | null
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value
  if (typeof value === "string") return Number(value) || 0
  return 0
}

function average(values: Array<number | null | undefined>) {
  const filtered = values.filter((value): value is number => typeof value === "number")
  if (!filtered.length) return 0
  return Math.round(filtered.reduce((sum, value) => sum + value, 0) / filtered.length)
}

async function listAdminUsers() {
  const pool = getPostgresPool()
  const result = await pool.query<{
    id: string
    email: string | null
    full_name: string | null
    created_at: string | null
    updated_at: string | null
  }>(
    `SELECT id, email, full_name, created_at, updated_at
     FROM profiles
     ORDER BY created_at DESC
     LIMIT 5000`
  )

  return result.rows.map((row) => ({
    id: row.id,
    email: row.email ?? null,
    name: row.full_name ?? null,
    joinedAt: row.created_at ?? null,
    lastActiveAt: row.updated_at ?? null,
  })) as AdminUserSummary[]
}

export async function getDashboardStats(): Promise<AdminStats> {
  const pool = getPostgresPool()
  const dayStart = startOfDay()
  const weekStart = startOfWeek()

  const [
    companiesTotal,
    companiesActive,
    jobsTotal,
    jobsToday,
    jobsWeek,
    alertsToday,
    crawlAgg,
    crawlDurationsToday,
  ] = await Promise.all([
    pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM companies`),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM companies WHERE is_active = true`
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM jobs WHERE is_active = true AND ${sqlJobLocatedInUsa("jobs")}`
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM jobs WHERE is_active = true AND ${sqlJobLocatedInUsa(
        "jobs"
      )} AND first_detected_at >= $1::timestamptz`,
      [dayStart]
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM jobs WHERE is_active = true AND ${sqlJobLocatedInUsa(
        "jobs"
      )} AND first_detected_at >= $1::timestamptz`,
      [weekStart]
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM alert_notifications WHERE sent_at >= $1::timestamptz`,
      [dayStart]
    ),
    pool.query<{ total: string; failed: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status IN ('failed', 'blocked', 'bad_url', 'fetch_error'))::text AS failed
       FROM crawl_logs
       WHERE crawled_at >= $1::timestamptz`,
      [dayStart]
    ),
    pool.query<{ duration_ms: number | null }>(
      `SELECT duration_ms FROM crawl_logs WHERE crawled_at >= $1::timestamptz`,
      [dayStart]
    ),
  ])

  const adminUsers = await listAdminUsers()
  const failedCrawlsToday = Number(crawlAgg.rows[0]?.failed ?? 0)

  return {
    totalCompanies: Number(companiesTotal.rows[0]?.c ?? 0),
    activeCompanies: Number(companiesActive.rows[0]?.c ?? 0),
    totalActiveJobs: Number(jobsTotal.rows[0]?.c ?? 0),
    jobsToday: Number(jobsToday.rows[0]?.c ?? 0),
    jobsThisWeek: Number(jobsWeek.rows[0]?.c ?? 0),
    totalUsers: adminUsers.length,
    usersToday: adminUsers.filter(
      (user: AdminUserSummary) =>
        user.joinedAt && new Date(user.joinedAt).getTime() >= new Date(dayStart).getTime()
    ).length,
    alertsSentToday: Number(alertsToday.rows[0]?.c ?? 0),
    crawlsToday: Number(crawlAgg.rows[0]?.total ?? 0),
    failedCrawlsToday,
    averageCrawlDuration: average(
      crawlDurationsToday.rows.map((crawl: { duration_ms: number | null }) => crawl.duration_ms)
    ),
  }
}

export async function getCrawlHealth(): Promise<CrawlHealth> {
  const pool = getPostgresPool()
  const failedWindow = subHours(24)
  const [latest, failedAgg, durations, noJobs, settingsRows] = await Promise.all([
    pool.query<CrawlLog>(
      `SELECT id, company_id, status, jobs_found, new_jobs, error_message, duration_ms, crawled_at
       FROM crawl_logs
       ORDER BY crawled_at DESC NULLS LAST
       LIMIT 1`
    ),
    pool.query<{ failed: string }>(
      `SELECT COUNT(*) FILTER (WHERE status IN ('failed', 'blocked', 'bad_url', 'fetch_error'))::text AS failed
       FROM crawl_logs
       WHERE crawled_at >= $1::timestamptz`,
      [failedWindow]
    ),
    pool.query<{ duration_ms: number | null }>(
      `SELECT duration_ms FROM crawl_logs WHERE crawled_at >= $1::timestamptz`,
      [failedWindow]
    ),
    pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM companies WHERE is_active = true AND job_count = 0`
    ),
    pool.query<SystemSetting>(`SELECT key, value, updated_at, updated_by FROM system_settings`),
  ])

  const lastCrawl = latest.rows[0] ?? null
  const failedCount = Number(failedAgg.rows[0]?.failed ?? 0)
  const settings = new Map(
    settingsRows.rows.map((row: SystemSetting) => [row.key, row.value])
  )
  const crawlSettings = (settings.get("crawl") ?? {}) as Record<string, unknown>
  const runtimeSettings = (settings.get("crawl_runtime") ?? {}) as Record<string, unknown>
  const intervalMinutes =
    typeof crawlSettings.intervalMinutes === "number" ? crawlSettings.intervalMinutes : 30

  const nextScheduledCrawl = lastCrawl
    ? new Date(new Date(lastCrawl.crawled_at).getTime() + intervalMinutes * 60_000).toISOString()
    : null

  const runtimeState = String(runtimeSettings.state ?? "")
  const runtimeStartedAt = String(runtimeSettings.startedAt ?? "")
  const runtimeFinishedAt = String(runtimeSettings.finishedAt ?? "")
  const startedTs = Date.parse(runtimeStartedAt)
  const finishedTs = Date.parse(runtimeFinishedAt)
  const latestCrawlTs = lastCrawl?.crawled_at ? Date.parse(lastCrawl.crawled_at) : NaN
  const now = Date.now()
  const runningFreshnessMs = Math.max(
    10 * 60_000,
    Math.min(45 * 60_000, intervalMinutes * 60_000 * 2)
  )
  const startupGraceMs = 3 * 60_000
  const progressFreshnessMs = 15 * 60_000
  const startedRecently = Number.isFinite(startedTs) && now - startedTs <= startupGraceMs
  const hasRecentProgress =
    Number.isFinite(latestCrawlTs) &&
    now - latestCrawlTs <= progressFreshnessMs &&
    (!Number.isFinite(startedTs) || latestCrawlTs >= startedTs - 60_000)
  const runtimeLooksActive =
    runtimeState === "running" &&
    Number.isFinite(startedTs) &&
    now - startedTs <= runningFreshnessMs &&
    (!Number.isFinite(finishedTs) || finishedTs < startedTs) &&
    (startedRecently || hasRecentProgress)

  let crawlerStatus: CrawlerStatus = "idle"
  if (runtimeLooksActive) {
    crawlerStatus = "running"
  } else if (failedCount > 0) {
    crawlerStatus = "error"
  }

  return {
    lastCrawlRun: lastCrawl?.crawled_at ?? null,
    nextScheduledCrawl,
    crawlerStatus,
    failedCrawlsLast24Hours: failedCount,
    averageCrawlDuration: average(
      durations.rows.map((crawl: { duration_ms: number | null }) => crawl.duration_ms)
    ),
    companiesWithZeroJobs: Number(noJobs.rows[0]?.c ?? 0),
  }
}

export async function getAPIUsage(): Promise<APIUsage> {
  const pool = getPostgresPool()
  const dayStart = startOfDay()

  const { rows } = await pool.query<ApiUsage>(
    `SELECT id, service, operation, tokens_used, cost_usd, created_at
     FROM api_usage
     WHERE created_at >= $1::timestamptz`,
    [dayStart]
  )

  return {
    claudeCallsToday: rows.filter((row: ApiUsage) => row.service === "claude").length,
    estimatedCostUsd: rows.reduce(
      (sum: number, row: ApiUsage) => sum + asNumber(row.cost_usd),
      0
    ),
    pushNotificationsSent: rows.filter((row: ApiUsage) => row.service === "webpush").length,
    emailsSent: rows.filter((row: ApiUsage) => row.service === "resend").length,
  }
}

export async function getAdminOverviewPayload(): Promise<AdminOverviewPayload> {
  const pool = getPostgresPool()
  const [stats, crawlHealth, apiUsage, crawlLogs, recentJobs, settingsRows] = await Promise.all([
    getDashboardStats(),
    getCrawlHealth(),
    getAPIUsage(),
    pool.query<
      CrawlLog & {
        company: Pick<Company, "id" | "name" | "ats_type"> | null
      }
    >(
      `SELECT cl.id, cl.company_id, cl.status, cl.jobs_found, cl.new_jobs, cl.error_message,
              cl.duration_ms, cl.crawled_at,
              CASE WHEN c.id IS NULL THEN NULL
                   ELSE jsonb_build_object('id', c.id, 'name', c.name, 'ats_type', c.ats_type)
              END AS company
       FROM crawl_logs cl
       LEFT JOIN companies c ON c.id = cl.company_id
       ORDER BY cl.crawled_at DESC NULLS LAST
       LIMIT 20`
    ),
    pool.query<
      Job & {
        company: Pick<Company, "id" | "name" | "ats_type" | "logo_url"> | null
      }
    >(
      `SELECT j.*,
              CASE WHEN c.id IS NULL THEN NULL
                   ELSE jsonb_build_object(
                     'id', c.id, 'name', c.name, 'ats_type', c.ats_type, 'logo_url', c.logo_url
                   )
              END AS company
       FROM jobs j
       LEFT JOIN companies c ON c.id = j.company_id
       WHERE j.is_active = true AND ${sqlJobLocatedInUsa("j")}
       ORDER BY j.first_detected_at DESC NULLS LAST
       LIMIT 20`
    ),
    pool.query<SystemSetting>(`SELECT key, value, updated_at, updated_by FROM system_settings`),
  ])

  const settings = Object.fromEntries(
    settingsRows.rows.map((row: SystemSetting) => [row.key, row.value])
  )

  return {
    stats,
    crawlHealth,
    apiUsage,
    realtime: {
      recentCrawlLogs: crawlLogs.rows as AdminRealtimePayload["recentCrawlLogs"],
      recentJobs: recentJobs.rows as AdminRealtimePayload["recentJobs"],
      settings,
    },
  }
}

export function summarizeChannels(notifications: AlertNotification[]) {
  return notifications.reduce(
    (summary, notification) => {
      if (notification.channel === "both") {
        summary.email += 1
        summary.push += 1
      } else if (notification.channel === "email") {
        summary.email += 1
      } else if (notification.channel === "push") {
        summary.push += 1
      }

      return summary
    },
    { email: 0, push: 0 } as Record<Exclude<NotificationChannel, "both">, number>
  )
}
