"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Loader2, PauseCircle, PlayCircle, RefreshCw } from "lucide-react"
import {
  AdminBadge,
  AdminButton,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminSelect,
  AdminStatCard,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/admin/format"
import type { Company, CrawlLog, SystemSetting } from "@/types"

function isFailureLikeStatus(status: string) {
  return status === "failed" || status === "blocked" || status === "bad_url" || status === "fetch_error"
}

export default function AdminCrawlMonitorPage() {
  const { pushToast } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [logs, setLogs] = useState<CrawlLog[]>([])
  const [settings, setSettings] = useState<Record<string, unknown>>({
    intervalMinutes: 30,
    paused: false,
    maxConcurrentCrawls: 5,
  })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("all")
  const [companyFilter, setCompanyFilter] = useState("all")
  const [dateFilter, setDateFilter] = useState("24h")
  const [page, setPage] = useState(1)
  const [runningAction, setRunningAction] = useState<string | null>(null)

  async function loadData() {
    setLoading(true)
    const [companiesRes, logsRes, settingsRes] = await Promise.all([
      fetch("/api/admin/companies"),
      fetch("/api/admin/crawl-logs"),
      fetch("/api/admin/system-settings"),
    ])

    const companiesData: Company[] = companiesRes.ok
      ? ((await companiesRes.json()) as { companies: Company[] }).companies
      : []
    const logsData: CrawlLog[] = logsRes.ok
      ? ((await logsRes.json()) as { crawlLogs: CrawlLog[] }).crawlLogs
      : []
    const settingsData: SystemSetting[] = settingsRes.ok
      ? ((await settingsRes.json()) as { settings: SystemSetting[] }).settings
      : []

    setCompanies(companiesData)
    setLogs(logsData)

    const crawlSettings = settingsData.find((s) => s.key === "crawl")
    setSettings(
      (crawlSettings?.value as Record<string, unknown>) ?? {
        intervalMinutes: 30,
        paused: false,
        maxConcurrentCrawls: 5,
      }
    )
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  const filteredLogs = useMemo(() => {
    const windowMs =
      dateFilter === "24h" ? 86_400_000 : dateFilter === "7d" ? 604_800_000 : Infinity

    return logs.filter((log) => {
      const matchesStatus = statusFilter === "all" || log.status === statusFilter
      const matchesCompany = companyFilter === "all" || log.company_id === companyFilter
      const matchesDate =
        Date.now() - new Date(log.crawled_at).getTime() <= windowMs
      return matchesStatus && matchesCompany && matchesDate
    })
  }, [companyFilter, dateFilter, logs, statusFilter])

  const failedLast24Hours = filteredLogs.filter(
    (log) =>
      isFailureLikeStatus(log.status) &&
      Date.now() - new Date(log.crawled_at).getTime() <= 86_400_000
  )

  const totalToday = logs.filter(
    (log) => Date.now() - new Date(log.crawled_at).getTime() <= 86_400_000
  )
  const successRate = totalToday.length
    ? Math.round(
        (totalToday.filter((log) => !isFailureLikeStatus(log.status)).length / totalToday.length) * 100
      )
    : 0
  const avgDuration = totalToday.length
    ? Math.round(
        totalToday.reduce((sum, log) => sum + (log.duration_ms ?? 0), 0) / totalToday.length
      )
    : 0
  const newJobsToday = totalToday.reduce((sum, log) => sum + log.new_jobs, 0)

  const atsPerformance = useMemo(() => {
    const companyMap = new Map(companies.map((company) => [company.id, company]))
    const grouped = new Map<
      string,
      { total: number; success: number; jobsFound: number; duration: number }
    >()

    for (const log of logs) {
      const ats = companyMap.get(log.company_id)?.ats_type ?? "custom"
      const current = grouped.get(ats) ?? {
        total: 0,
        success: 0,
        jobsFound: 0,
        duration: 0,
      }
      current.total += 1
      if (!isFailureLikeStatus(log.status)) current.success += 1
      current.jobsFound += log.jobs_found
      current.duration += log.duration_ms ?? 0
      grouped.set(ats, current)
    }

    return Array.from(grouped.entries()).map(([ats, values]) => ({
      ats,
      successRate: values.total ? Math.round((values.success / values.total) * 100) : 0,
      averageJobs: values.total ? (values.jobsFound / values.total).toFixed(1) : "0.0",
      averageDuration: values.total ? Math.round(values.duration / values.total) : 0,
    }))
  }, [companies, logs])

  const paginatedLogs = filteredLogs.slice((page - 1) * 50, page * 50)

  async function runCrawl(type: "all" | "failed") {
    if (!window.confirm("Start this crawl action now?")) return

    setRunningAction(type)
    const response = await fetch("/api/admin/crawl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    })
    setRunningAction(null)

    const body = (await response.json()) as { error?: string }

    if (!response.ok) {
      pushToast({
        tone: "error",
        title: "Unable to start crawl",
        description: body.error ?? "Unknown error",
      })
      return
    }

    pushToast({
      tone: "success",
      title: "Crawl started",
      description: type === "all" ? "All companies queued." : "Failed companies queued.",
    })
  }

  async function saveSettings(nextSettings: Record<string, unknown>) {
    const res = await fetch("/api/admin/system-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "crawl", value: nextSettings }),
    })

    if (!res.ok) {
      pushToast({
        tone: "error",
        title: "Unable to save crawl settings",
        description: "Request failed",
      })
      return
    }

    setSettings(nextSettings)
    pushToast({
      tone: "success",
      title: "Crawl settings updated",
      description: "Crawler controls were saved.",
    })
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Crawl monitor"
        title="Crawler operations"
        description="Run the crawler manually, inspect failures, and watch which ATS integrations are holding up or falling over."
      />

      <AdminPanel
        title="Crawl controls"
        description="Emergency controls for the crawler plus the live interval configuration."
      >
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]">
          <AdminButton onClick={() => void runCrawl("all")} disabled={runningAction === "all"}>
            {runningAction === "all" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Run all crawls now
          </AdminButton>
          <AdminButton
            tone="secondary"
            onClick={() => void runCrawl("failed")}
            disabled={runningAction === "failed"}
          >
            {runningAction === "failed" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <AlertTriangle className="mr-2 h-4 w-4" />
            )}
            Run failed companies only
          </AdminButton>
          <div className="grid gap-3 sm:grid-cols-2">
            <AdminInput
              type="number"
              value={String(settings.intervalMinutes ?? 30)}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  intervalMinutes: Number(event.target.value),
                }))
              }
              placeholder="Interval"
            />
            <AdminInput
              type="number"
              value={String(settings.maxConcurrentCrawls ?? 5)}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  maxConcurrentCrawls: Number(event.target.value),
                }))
              }
              placeholder="Concurrency"
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() =>
                void saveSettings({ ...settings, paused: !Boolean(settings.paused) })
              }
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              {settings.paused ? (
                <PlayCircle className="h-4 w-4 text-emerald-600" />
              ) : (
                <PauseCircle className="h-4 w-4 text-red-600" />
              )}
              {settings.paused ? "Resume crawls" : "Pause all crawls"}
            </button>
            <AdminButton tone="secondary" onClick={() => void saveSettings(settings)}>
              Save settings
            </AdminButton>
          </div>
        </div>
      </AdminPanel>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <AdminStatCard label="Total crawls today" value={formatNumber(totalToday.length)} />
        <AdminStatCard
          label="Success rate today"
          value={`${successRate}%`}
          tone={successRate < 90 ? "danger" : "success"}
        />
        <AdminStatCard label="New jobs found today" value={formatNumber(newJobsToday)} tone="info" />
        <AdminStatCard label="Average duration" value={`${formatNumber(avgDuration)}ms`} />
        <AdminStatCard
          label="Failed crawls"
          value={formatNumber(failedLast24Hours.length)}
          tone={failedLast24Hours.length > 0 ? "danger" : "success"}
        />
      </div>

      {failedLast24Hours.length > 0 ? (
        <AdminPanel
          title="Failed crawls in the last 24 hours"
          description="These are the crawls that need attention first."
          className="border-red-200"
        >
          <div className="space-y-3">
            {failedLast24Hours.slice(0, 8).map((log) => {
              const company = companies.find((entry) => entry.id === log.company_id)
              return (
                <div
                  key={log.id}
                  className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-red-900">
                        {company?.name ?? "Unknown company"}
                      </p>
                      <p className="mt-2 text-sm text-red-700">{log.error_message}</p>
                    </div>
                    <AdminButton
                      tone="danger"
                      className="px-3 py-2 text-xs"
                      onClick={async () => {
                        await fetch("/api/admin/crawl", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ type: "company", id: log.company_id }),
                        })
                        pushToast({
                          tone: "success",
                          title: "Retry queued",
                          description: company?.name ?? "Company",
                        })
                      }}
                    >
                      Retry now
                    </AdminButton>
                  </div>
                </div>
              )
            })}
          </div>
        </AdminPanel>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <AdminPanel
          title="Crawl history"
          description="Filter the last crawl runs by status, company, and time window."
        >
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <AdminSelect
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="unchanged">Unchanged</option>
              <option value="failed">Failed</option>
              <option value="blocked">Blocked</option>
              <option value="fetch_error">Fetch error</option>
              <option value="bad_url">Bad URL</option>
            </AdminSelect>
            <AdminSelect
              value={companyFilter}
              onChange={(event) => setCompanyFilter(event.target.value)}
            >
              <option value="all">All companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </AdminSelect>
            <AdminSelect value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="all">All time</option>
            </AdminSelect>
          </div>

          {loading ? (
            <div className="flex items-center gap-3 py-12 text-gray-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading crawl history
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedLogs.map((log) => {
                const company = companies.find((entry) => entry.id === log.company_id)
                return (
                  <div
                    key={log.id}
                    className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-gray-900">
                            {company?.name ?? "Unknown company"}
                          </p>
                          <AdminBadge
                            tone={
                              log.status === "failed"
                                ? "danger"
                                : log.status === "blocked" || log.status === "fetch_error"
                                  ? "danger"
                                  : log.status === "bad_url"
                                    ? "warning"
                                : log.status === "success"
                                  ? "success"
                                  : "neutral"
                            }
                          >
                            {log.status}
                          </AdminBadge>
                          <AdminBadge tone="info">+{log.new_jobs} new</AdminBadge>
                          <AdminBadge>{log.jobs_found} jobs</AdminBadge>
                          <AdminBadge>{log.duration_ms ?? 0}ms</AdminBadge>
                        </div>
                        {log.error_message ? (
                          <details className="mt-2 text-sm text-red-600">
                            <summary className="cursor-pointer font-medium">
                              View error message
                            </summary>
                            <p className="mt-2 whitespace-pre-wrap">{log.error_message}</p>
                          </details>
                        ) : null}
                      </div>
                      <div className="text-right text-xs text-gray-500">
                        <p>{formatRelativeTime(log.crawled_at)}</p>
                        <p className="mt-1">{formatDateTime(log.crawled_at)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}

              <div className="flex items-center justify-between pt-3">
                <p className="text-sm text-gray-500">
                  Page {page} of {Math.max(1, Math.ceil(filteredLogs.length / 50))}
                </p>
                <div className="flex gap-2">
                  <AdminButton
                    tone="secondary"
                    disabled={page === 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    Previous
                  </AdminButton>
                  <AdminButton
                    tone="secondary"
                    disabled={page >= Math.ceil(filteredLogs.length / 50)}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </AdminButton>
                </div>
              </div>
            </div>
          )}
        </AdminPanel>

        <AdminPanel
          title="ATS performance"
          description="Use this to identify which parsers need attention first."
        >
          <div className="space-y-3">
            {atsPerformance.map((entry) => (
              <div
                key={entry.ats}
                className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-900">{entry.ats}</p>
                    <p className="mt-1 text-sm text-gray-500">
                      {entry.averageJobs} jobs per crawl · {entry.averageDuration}ms average duration
                    </p>
                  </div>
                  <AdminBadge tone={entry.successRate < 85 ? "warning" : "success"}>
                    {entry.successRate}% success
                  </AdminBadge>
                </div>
              </div>
            ))}
          </div>
        </AdminPanel>
      </div>
    </div>
  )
}
