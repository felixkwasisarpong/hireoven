import { startOfDay, startOfWeek, subHours } from "@/lib/admin/time"
import { createAdminClient } from "@/lib/supabase/admin"
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
  const supabase = createAdminClient()
  const users: AdminUserSummary[] = []
  let page = 1

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    })

    if (error) throw error

    const pageUsers = data?.users ?? []
    users.push(
      ...pageUsers.map((user) => ({
        id: user.id,
        email: user.email ?? null,
        name:
          (typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null) ??
          (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null),
        joinedAt: user.created_at ?? null,
        lastActiveAt: user.last_sign_in_at ?? null,
      }))
    )

    if (pageUsers.length < 200) break
    page += 1
  }

  return users
}

export async function getDashboardStats(): Promise<AdminStats> {
  const supabase = createAdminClient()
  const dayStart = startOfDay()
  const weekStart = startOfWeek()

  const [
    companiesTotal,
    companiesActive,
    jobsTotal,
    jobsToday,
    jobsWeek,
    alertsToday,
    crawlsToday,
    crawlDurationsToday,
    users,
  ] = await Promise.all([
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .gte("first_detected_at", dayStart),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .gte("first_detected_at", weekStart),
    supabase
      .from("alert_notifications")
      .select("id", { count: "exact", head: true })
      .gte("sent_at", dayStart),
    supabase
      .from("crawl_logs")
      .select("id, status")
      .gte("crawled_at", dayStart),
    supabase
      .from("crawl_logs")
      .select("duration_ms")
      .gte("crawled_at", dayStart),
    listAdminUsers(),
  ])

  const failedCrawlsToday = ((crawlsToday.data ?? []) as Array<{ status: string | null }>).filter(
    (crawl) => crawl.status === "failed"
  ).length

  return {
    totalCompanies: companiesTotal.count ?? 0,
    activeCompanies: companiesActive.count ?? 0,
    totalActiveJobs: jobsTotal.count ?? 0,
    jobsToday: jobsToday.count ?? 0,
    jobsThisWeek: jobsWeek.count ?? 0,
    totalUsers: users.length,
    usersToday: users.filter(
      (user) => user.joinedAt && new Date(user.joinedAt).getTime() >= new Date(dayStart).getTime()
    ).length,
    alertsSentToday: alertsToday.count ?? 0,
    crawlsToday: crawlsToday.data?.length ?? 0,
    failedCrawlsToday,
    averageCrawlDuration: average(
      ((crawlDurationsToday.data ?? []) as Array<{ duration_ms: number | null }>).map(
        (crawl) => crawl.duration_ms
      )
    ),
  }
}

export async function getCrawlHealth(): Promise<CrawlHealth> {
  const supabase = createAdminClient()
  const failedWindow = subHours(24)
  const runningThreshold = subHours(1)
  const [latest, failed, durations, noJobs, settingsRows] = await Promise.all([
    supabase
      .from("crawl_logs")
      .select("id, status, crawled_at, duration_ms")
      .order("crawled_at", { ascending: false })
      .limit(1),
    supabase
      .from("crawl_logs")
      .select("id, status")
      .gte("crawled_at", failedWindow),
    supabase
      .from("crawl_logs")
      .select("duration_ms")
      .gte("crawled_at", failedWindow),
    supabase
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("job_count", 0),
    supabase.from("system_settings").select("key, value"),
  ])

  const lastCrawl = (latest.data?.[0] as CrawlLog | undefined) ?? null
  const failedCount = ((failed.data ?? []) as CrawlLog[]).filter(
    (crawl) => crawl.status === "failed"
  ).length
  const settings = new Map(
    ((settingsRows.data ?? []) as SystemSetting[]).map((row) => [row.key, row.value])
  )
  const crawlSettings = (settings.get("crawl") ?? {}) as Record<string, unknown>
  const intervalMinutes =
    typeof crawlSettings.intervalMinutes === "number" ? crawlSettings.intervalMinutes : 30

  const nextScheduledCrawl = lastCrawl
    ? new Date(new Date(lastCrawl.crawled_at).getTime() + intervalMinutes * 60_000).toISOString()
    : null

  let crawlerStatus: CrawlerStatus = "idle"
  if (failedCount > 0) crawlerStatus = "error"
  if (lastCrawl && new Date(lastCrawl.crawled_at).getTime() >= new Date(runningThreshold).getTime()) {
    crawlerStatus = "running"
  }

  return {
    lastCrawlRun: lastCrawl?.crawled_at ?? null,
    nextScheduledCrawl,
    crawlerStatus,
    failedCrawlsLast24Hours: failedCount,
    averageCrawlDuration: average(
      ((durations.data ?? []) as Array<{ duration_ms: number | null }>).map(
        (crawl) => crawl.duration_ms
      )
    ),
    companiesWithZeroJobs: noJobs.count ?? 0,
  }
}

export async function getAPIUsage(): Promise<APIUsage> {
  const supabase = createAdminClient()
  const dayStart = startOfDay()

  const { data, error } = await supabase
    .from("api_usage")
    .select("service, operation, cost_usd")
    .gte("created_at", dayStart)

  if (error) throw error

  const rows = (data ?? []) as ApiUsage[]

  return {
    claudeCallsToday: rows.filter((row) => row.service === "claude").length,
    estimatedCostUsd: rows.reduce((sum, row) => sum + asNumber(row.cost_usd), 0),
    pushNotificationsSent: rows.filter((row) => row.service === "webpush").length,
    emailsSent: rows.filter((row) => row.service === "resend").length,
  }
}

export async function getAdminOverviewPayload(): Promise<AdminOverviewPayload> {
  const supabase = createAdminClient()
  const [stats, crawlHealth, apiUsage, crawlLogs, recentJobs, settingsRows] = await Promise.all([
    getDashboardStats(),
    getCrawlHealth(),
    getAPIUsage(),
    (supabase
      .from("crawl_logs")
      .select("*, company:companies(id, name, ats_type)")
      .order("crawled_at", { ascending: false })
      .limit(20) as any),
    (supabase
      .from("jobs")
      .select("*, company:companies(id, name, ats_type, logo_url)")
      .order("first_detected_at", { ascending: false })
      .limit(20) as any),
    supabase.from("system_settings").select("key, value"),
  ])

  const settings = Object.fromEntries(
    ((settingsRows.data ?? []) as SystemSetting[]).map((row) => [row.key, row.value])
  )

  return {
    stats,
    crawlHealth,
    apiUsage,
    realtime: {
      recentCrawlLogs: (crawlLogs.data ?? []) as AdminRealtimePayload["recentCrawlLogs"],
      recentJobs: (recentJobs.data ?? []) as AdminRealtimePayload["recentJobs"],
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
