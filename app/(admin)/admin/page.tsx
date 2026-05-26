"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Activity,
  BellRing,
  Briefcase,
  Building2,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react"
import {
  AdminButton,
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
  AdminBadge,
} from "@/components/admin/AdminPrimitives"
import { formatCurrency, formatDateTime, formatNumber, formatRelativeTime } from "@/lib/admin/format"
import type { AdminOverviewPayload } from "@/lib/admin/stats"

type CrawlFeedItem = AdminOverviewPayload["realtime"]["recentCrawlLogs"][number]
type JobFeedItem = AdminOverviewPayload["realtime"]["recentJobs"][number]

function StatusTone({ status }: { status: string | null }) {
  if (status === "success") return <AdminBadge tone="success">Success</AdminBadge>
  if (status === "failed") return <AdminBadge tone="danger">Failed</AdminBadge>
  if (status === "blocked") return <AdminBadge tone="danger">Blocked</AdminBadge>
  if (status === "fetch_error") return <AdminBadge tone="danger">Fetch error</AdminBadge>
  if (status === "bad_url") return <AdminBadge tone="warning">Bad URL</AdminBadge>
  if (status === "unchanged") return <AdminBadge>Unchanged</AdminBadge>
  return <AdminBadge>Unknown</AdminBadge>
}

export default function AdminOverviewPage() {
  const [payload, setPayload] = useState<AdminOverviewPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const crawlFeedRef = useRef<HTMLDivElement | null>(null)
  const jobsFeedRef = useRef<HTMLDivElement | null>(null)

  const loadOverview = useCallback(async () => {
    setError(null)
    setIsLoading(true)
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" })
      const data = (await response.json()) as AdminOverviewPayload | { error: string }
      if (!response.ok) {
        throw new Error("error" in data ? data.error : "Unable to load admin stats")
      }
      setPayload(data as AdminOverviewPayload)
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadOverview()
    }, 15_000)
    return () => window.clearInterval(interval)
  }, [loadOverview])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (crawlFeedRef.current) {
      crawlFeedRef.current.scrollTop = crawlFeedRef.current.scrollHeight
    }
    if (jobsFeedRef.current) {
      jobsFeedRef.current.scrollTop = jobsFeedRef.current.scrollHeight
    }
  }, [payload?.realtime.recentCrawlLogs.length, payload?.realtime.recentJobs.length])

  if (isLoading && !payload) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-gray-500">
        <Loader2 className="mr-3 h-5 w-5 animate-spin" />
        Loading admin overview
      </div>
    )
  }

  if (error && !payload) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700">
        <p className="text-lg font-semibold">Unable to load admin overview</p>
        <p className="mt-2 text-sm">{error}</p>
        <AdminButton className="mt-4" onClick={() => void loadOverview()}>
          Try again
        </AdminButton>
      </div>
    )
  }

  if (!payload) return null

  const { stats, crawlHealth, apiUsage, reliability, realtime } = payload
  const crawlSettings = (realtime.settings.crawl ?? {}) as Record<string, unknown>
  const paused = Boolean(crawlSettings.paused)
  const intervalMinutes =
    typeof crawlSettings.intervalMinutes === "number" ? crawlSettings.intervalMinutes : 30

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Overview"
        title="Mission control"
        description="Watch the crawl system run, see jobs land in real time, and keep the whole product healthy from one dense operations dashboard."
        actions={
          <AdminButton tone="secondary" onClick={() => void loadOverview()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </AdminButton>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Total companies tracked"
          value={formatNumber(stats.totalCompanies)}
          hint={`${formatNumber(stats.activeCompanies)} active`}
        />
        <AdminStatCard
          label="Total active jobs"
          value={formatNumber(stats.totalActiveJobs)}
          hint={`${formatNumber(stats.jobsToday)} added today`}
          tone="info"
        />
        <AdminStatCard
          label="Jobs added this week"
          value={formatNumber(stats.jobsThisWeek)}
          hint={`${formatNumber(stats.crawlsToday)} crawls run today`}
        />
        <AdminStatCard
          label="Total users"
          value={formatNumber(stats.totalUsers)}
          hint={`${formatNumber(stats.usersToday)} new today`}
        />
        <AdminStatCard
          label="Alerts sent today"
          value={formatNumber(stats.alertsSentToday)}
          hint={`${formatNumber(apiUsage.emailsSent)} emails / ${formatNumber(
            apiUsage.pushNotificationsSent
          )} push`}
        />
        <AdminStatCard
          label="Crawls run today"
          value={formatNumber(stats.crawlsToday)}
          hint={`${formatNumber(stats.averageCrawlDuration)}ms avg duration`}
        />
        <AdminStatCard
          label="Failed crawls today"
          value={formatNumber(stats.failedCrawlsToday)}
          hint="Keeps parser issues visible fast"
          tone={stats.failedCrawlsToday > 0 ? "danger" : "success"}
        />
        <AdminStatCard
          label="Crawler status"
          value={crawlHealth.crawlerStatus.toUpperCase()}
          hint={paused ? "Global pause is enabled" : `Interval: ${intervalMinutes} min`}
          tone={
            crawlHealth.crawlerStatus === "error"
              ? "danger"
              : crawlHealth.crawlerStatus === "running"
                ? "success"
                : "default"
          }
        />
      </div>

      <AdminPanel
        title="Reliability guardrails"
        description="Track quality regressions that directly break user trust in the feed and billing surfaces."
        actions={
          <AdminBadge tone="neutral">
            Updated {formatRelativeTime(reliability.computedAt, now)}
          </AdminBadge>
        }
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <AdminStatCard
            label="Feed duplicate rate"
            value={formatPercent(reliability.duplicateRate.ratePercent)}
            hint={`${formatNumber(reliability.duplicateRate.duplicateRows)} duplicate rows / ${formatNumber(reliability.duplicateRate.totalTitledRows)} titled jobs`}
            tone={reliability.duplicateRate.ratePercent > 1 ? "danger" : "success"}
          />
          <AdminStatCard
            label="Null title rate"
            value={formatPercent(reliability.nullTitleRate.ratePercent)}
            hint={`${formatNumber(reliability.nullTitleRate.nullTitleRows)} null-title rows / ${formatNumber(reliability.nullTitleRate.totalRows)} active jobs`}
            tone={reliability.nullTitleRate.ratePercent > 0 ? "danger" : "success"}
          />
          <AdminStatCard
            label="Match score missing rate"
            value={formatPercent(reliability.matchScoreMissingRate.ratePercent)}
            hint={`${formatNumber(reliability.matchScoreMissingRate.missingRows)} missing pairs / ${formatNumber(reliability.matchScoreMissingRate.totalRows)} pairs (${formatNumber(reliability.matchScoreMissingRate.sampledUsers)} users x ${formatNumber(reliability.matchScoreMissingRate.sampledJobs)} jobs)`}
            tone={reliability.matchScoreMissingRate.ratePercent > 2 ? "danger" : "success"}
          />
          <AdminStatCard
            label="Watchlist mismatch rate"
            value={formatPercent(reliability.watchlistMismatchRate.ratePercent)}
            hint={`${formatNumber(reliability.watchlistMismatchRate.mismatchedUsers)} mismatched users / ${formatNumber(reliability.watchlistMismatchRate.trackedUsers)} tracked users`}
            tone={reliability.watchlistMismatchRate.ratePercent > 0 ? "danger" : "success"}
          />
          <AdminStatCard
            label="Scraper artifact rate"
            value={formatPercent(reliability.scraperArtifactRate.ratePercent)}
            hint={`${formatNumber(reliability.scraperArtifactRate.artifactRows)} artifact rows / ${formatNumber(reliability.scraperArtifactRate.totalRows)} active jobs`}
            tone={reliability.scraperArtifactRate.ratePercent > 0 ? "danger" : "success"}
          />
          <AdminStatCard
            label="Subscription mismatch rate"
            value={formatPercent(reliability.subscriptionMismatchRate.ratePercent)}
            hint={`${formatNumber(reliability.subscriptionMismatchRate.mismatchedSnapshots)} mismatched snapshots / ${formatNumber(reliability.subscriptionMismatchRate.trackedSnapshots)} tracked snapshots`}
            tone={reliability.subscriptionMismatchRate.ratePercent > 0 ? "danger" : "success"}
          />
        </div>
        <div className="mt-4 rounded-2xl border border-gray-200 bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-500">
            24h Trend vs Previous 24h
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <ReliabilityTrendCard
              label="Duplicate rate"
              trend={reliability.trends24h.duplicateRate}
            />
            <ReliabilityTrendCard
              label="Null title rate"
              trend={reliability.trends24h.nullTitleRate}
            />
            <ReliabilityTrendCard
              label="Scraper artifact rate"
              trend={reliability.trends24h.scraperArtifactRate}
            />
          </div>
        </div>
      </AdminPanel>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr_0.9fr]">
        <AdminPanel
          title="Live crawl feed"
          description="Latest crawl activity across the system. This feed updates as soon as new crawl logs arrive."
        >
          <div
            ref={crawlFeedRef}
            className="soft-scrollbar max-h-[560px] space-y-3 overflow-y-auto pr-1"
          >
            {realtime.recentCrawlLogs.map((log) => (
              <div
                key={log.id}
                className="rounded-3xl border border-gray-200 bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FAFC_100%)] px-4 py-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">
                      {log.company?.name ?? "Unknown company"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <StatusTone status={log.status} />
                      {log.new_jobs > 0 ? (
                        <AdminBadge tone="info">+{log.new_jobs} new jobs</AdminBadge>
                      ) : null}
                      <AdminBadge>{formatNumber(log.duration_ms)}ms</AdminBadge>
                    </div>
                    {log.error_message ? (
                      <p className="mt-2 text-sm text-red-600">{log.error_message}</p>
                    ) : null}
                  </div>
                  <p className="text-xs text-gray-500">
                    {formatRelativeTime(log.crawled_at, now)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </AdminPanel>

        <AdminPanel
          title="New jobs stream"
          description="Fresh jobs landing in the database right now."
        >
          <div ref={jobsFeedRef} className="soft-scrollbar max-h-[560px] space-y-3 overflow-y-auto pr-1">
            {realtime.recentJobs.map((job) => (
              <div
                key={job.id}
                className="rounded-3xl border border-gray-200 bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FAFC_100%)] px-4 py-3 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{job.title}</p>
                    <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
                      <span>{job.company?.name ?? "Unknown company"}</span>
                      {job.company?.ats_type ? (
                        <AdminBadge tone="dark">{job.company.ats_type}</AdminBadge>
                      ) : null}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    {formatRelativeTime(job.first_detected_at, now)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </AdminPanel>

        <AdminPanel
          title="System health"
          description="Live crawl cadence, parser pressure, and outbound delivery health."
        >
          <div className="space-y-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <HealthRow
                icon={Activity}
                label="Last crawl run"
                value={formatDateTime(crawlHealth.lastCrawlRun)}
              />
              <HealthRow
                icon={RefreshCw}
                label="Next scheduled crawl"
                value={formatDateTime(crawlHealth.nextScheduledCrawl)}
              />
              <HealthRow
                icon={Activity}
                label="Crawler status"
                value={crawlHealth.crawlerStatus}
                tone={
                  crawlHealth.crawlerStatus === "error"
                    ? "danger"
                    : crawlHealth.crawlerStatus === "running"
                      ? "success"
                      : "neutral"
                }
              />
              <HealthRow
                icon={Activity}
                label="Failed crawls in last 24h"
                value={formatNumber(crawlHealth.failedCrawlsLast24Hours)}
                tone={crawlHealth.failedCrawlsLast24Hours > 0 ? "danger" : "success"}
              />
              <HealthRow
                icon={Building2}
                label="Companies with 0 jobs"
                value={formatNumber(crawlHealth.companiesWithZeroJobs)}
                tone={crawlHealth.companiesWithZeroJobs > 0 ? "warning" : "success"}
              />
              <HealthRow
                icon={Activity}
                label="Average crawl duration"
                value={`${formatNumber(crawlHealth.averageCrawlDuration)}ms`}
              />
            </div>

            <div className="rounded-3xl border border-gray-200 bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FAFC_100%)] p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500">
                API usage today
              </p>
              <div className="mt-4 space-y-3">
                <HealthRow
                  icon={Briefcase}
                  label="Claude API calls"
                  value={formatNumber(apiUsage.claudeCallsToday)}
                />
                <HealthRow
                  icon={Building2}
                  label="Estimated cost"
                  value={formatCurrency(apiUsage.estimatedCostUsd)}
                />
                <HealthRow
                  icon={BellRing}
                  label="Push notifications sent"
                  value={formatNumber(apiUsage.pushNotificationsSent)}
                />
                <HealthRow
                  icon={Users}
                  label="Emails sent"
                  value={formatNumber(apiUsage.emailsSent)}
                />
              </div>
            </div>
          </div>
        </AdminPanel>
      </div>
    </div>
  )
}

function formatPercent(value: number): string {
  return `${(Number.isFinite(value) ? value : 0).toFixed(2)}%`
}

function formatTrendDelta(value: number): string {
  if (!Number.isFinite(value) || Math.abs(value) < 0.01) return "0.00 pp"
  return `${value > 0 ? "+" : ""}${value.toFixed(2)} pp`
}

function ReliabilityTrendCard({
  label,
  trend,
}: {
  label: string
  trend: AdminOverviewPayload["reliability"]["trends24h"]["duplicateRate"]
}) {
  const delta = trend.deltaPercentPoints
  const tone =
    delta > 0.01
      ? "danger"
      : delta < -0.01
        ? "success"
        : "neutral"

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <AdminBadge tone={tone}>
          {formatTrendDelta(delta)}
        </AdminBadge>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Current {formatPercent(trend.current.ratePercent)} · Previous {formatPercent(trend.previous.ratePercent)}
      </p>
    </div>
  )
}

function HealthRow({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  tone?: "neutral" | "success" | "danger" | "warning"
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-3 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-gray-100 p-2 text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-gray-600">{label}</p>
      </div>
      <p
        className={[
          "font-semibold capitalize text-gray-950",
          tone === "success" ? "text-emerald-600" : "",
          tone === "danger" ? "text-red-600" : "",
          tone === "warning" ? "text-amber-600" : "",
        ].join(" ")}
      >
        {value}
      </p>
    </div>
  )
}
