"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Search } from "lucide-react"
import {
  AdminBadge,
  AdminInput,
  AdminPageHeader,
  AdminPanel,
  AdminStatCard,
} from "@/components/admin/AdminPrimitives"
import { useToast } from "@/components/ui/ToastProvider"
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/admin/format"
import { createClient } from "@/lib/supabase/client"
import type { AlertNotification, Company, Job, JobAlert, Profile } from "@/types"

type AlertLogRow = AlertNotification & {
  alert: Pick<JobAlert, "id" | "name"> | null
  user: Pick<Profile, "email" | "full_name"> | null
  job:
    | (Pick<Job, "id" | "title" | "apply_url"> & {
        company: Pick<Company, "name"> | null
      })
    | null
}

export default function AdminAlertsPage() {
  const supabase = useMemo(() => createClient(), [])
  const { pushToast } = useToast()
  const [logs, setLogs] = useState<AlertLogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [channelFilter, setChannelFilter] = useState("all")
  const [now, setNow] = useState(Date.now())

  async function loadLogs() {
    setLoading(true)
    const { data, error } = await ((supabase.from("alert_notifications") as any)
      .select(
        "*, alert:job_alerts(id, name), user:profiles(email, full_name), job:jobs(id, title, apply_url, company:companies(name))"
      )
      .order("sent_at", { ascending: false }))

    if (error) {
      pushToast({
        tone: "error",
        title: "Unable to load alert logs",
        description: error.message,
      })
      setLoading(false)
      return
    }

    setLogs((data ?? []) as AlertLogRow[])
    setLoading(false)
  }

  useEffect(() => {
    void loadLogs()
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel("admin-alert-log")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alert_notifications" },
        () => void loadLogs()
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase])

  const visibleLogs = useMemo(() => {
    const query = search.trim().toLowerCase()
    return logs.filter((log) => {
      const matchesSearch =
        !query ||
        log.user?.email?.toLowerCase().includes(query) ||
        log.job?.title?.toLowerCase().includes(query) ||
        log.job?.company?.name?.toLowerCase().includes(query) ||
        log.alert?.name?.toLowerCase().includes(query)
      const matchesChannel = channelFilter === "all" || log.channel === channelFilter
      return matchesSearch && matchesChannel
    })
  }, [channelFilter, logs, search])

  const todayLogs = logs.filter(
    (log) => Date.now() - new Date(log.sent_at).getTime() <= 86_400_000
  )
  const openedToday = todayLogs.filter((log) => log.opened_at).length
  const clickedToday = todayLogs.filter((log) => log.clicked_at).length
  const openRate = todayLogs.length ? Math.round((openedToday / todayLogs.length) * 100) : 0
  const clickRate = todayLogs.length ? Math.round((clickedToday / todayLogs.length) * 100) : 0

  const mostTriggered = useMemo(() => {
    const counts = new Map<string, number>()
    for (const log of logs) {
      const key =
        log.notification_type === "watchlist"
          ? "Watchlist"
          : log.alert?.name ?? "Unnamed alert"
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    return Array.from(counts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
  }, [logs])

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Alerts log"
        title="Notification activity"
        description="Track every alert and watchlist send, watch engagement rates, and see which saved searches are pulling the most traffic."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Open rate today"
          value={`${openRate}%`}
          tone={openRate > 30 ? "success" : "default"}
        />
        <AdminStatCard
          label="Click rate today"
          value={`${clickRate}%`}
          tone={clickRate > 10 ? "success" : "info"}
        />
        <AdminStatCard
          label="Notifications sent today"
          value={formatNumber(todayLogs.length)}
        />
        <AdminStatCard
          label="Most triggered"
          value={mostTriggered[0]?.[0] ?? "None yet"}
          hint={mostTriggered[0] ? `${formatNumber(mostTriggered[0][1])} sends` : undefined}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <AdminPanel
          title="Notifications log"
          description="Every notification row, searchable by user, company, job title, and alert name."
        >
          <div className="mb-4 grid gap-3 lg:grid-cols-[1.3fr_220px]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-gray-400" />
              <AdminInput
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search email, company, job title, alert name"
                className="pl-9"
              />
            </div>
            <select
              value={channelFilter}
              onChange={(event) => setChannelFilter(event.target.value)}
              className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none"
            >
              <option value="all">All channels</option>
              <option value="email">Email only</option>
              <option value="push">Push only</option>
              <option value="both">Both</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.2em] text-gray-400">
                <tr>
                  <th className="px-3 py-3">User email</th>
                  <th className="px-3 py-3">Job + company</th>
                  <th className="px-3 py-3">Alert</th>
                  <th className="px-3 py-3">Channel</th>
                  <th className="px-3 py-3">Sent at</th>
                  <th className="px-3 py-3">Opened at</th>
                  <th className="px-3 py-3">Clicked at</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                      <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
                      Loading alert notifications
                    </td>
                  </tr>
                ) : visibleLogs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                      No notifications match the current filters.
                    </td>
                  </tr>
                ) : (
                  visibleLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="px-3 py-4 font-medium text-gray-900">
                        {log.user?.email ?? "Unknown"}
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-medium text-gray-900">{log.job?.title ?? "Missing job"}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {log.job?.company?.name ?? "Unknown company"}
                        </p>
                      </td>
                      <td className="px-3 py-4">
                        <AdminBadge tone={log.notification_type === "watchlist" ? "info" : "neutral"}>
                          {log.notification_type === "watchlist"
                            ? "Watchlist"
                            : log.alert?.name ?? "Unnamed alert"}
                        </AdminBadge>
                      </td>
                      <td className="px-3 py-4">
                        <AdminBadge tone="dark">{log.channel}</AdminBadge>
                      </td>
                      <td className="px-3 py-4">
                        <p className="text-gray-900">{formatDateTime(log.sent_at)}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          {formatRelativeTime(log.sent_at, now)}
                        </p>
                      </td>
                      <td className="px-3 py-4 text-gray-600">{formatDateTime(log.opened_at)}</td>
                      <td className="px-3 py-4 text-gray-600">{formatDateTime(log.clicked_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </AdminPanel>

        <AdminPanel
          title="Most triggered alerts"
          description="These alerts are firing the most often and should guide which saved-search workflows deserve product attention."
        >
          <div className="space-y-3">
            {mostTriggered.length === 0 ? (
              <p className="text-sm text-gray-500">No alert activity yet.</p>
            ) : (
              mostTriggered.map(([name, count]) => (
                <div
                  key={name}
                  className="flex items-center justify-between rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3"
                >
                  <p className="font-medium text-gray-900">{name}</p>
                  <AdminBadge tone="info">{formatNumber(count)} sends</AdminBadge>
                </div>
              ))
            )}
          </div>
        </AdminPanel>
      </div>
    </div>
  )
}
