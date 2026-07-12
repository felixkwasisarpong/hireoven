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
import { PERSONA_LABELS, countdownLabel } from "@/lib/interview/format"

type ScheduledRow = {
  id: string
  userId: string
  userEmail: string | null
  userName: string | null
  scheduledAt: string
  scheduledTimezone: string | null
  durationTargetMin: number
  persona: string
  questionSet: string
  jobTitle: string | null
  jobCompany: string | null
  remindersSent: number
  createdAt: string
}

const DAY_MS = 86_400_000

export default function AdminInterviewsPage() {
  const { pushToast } = useToast()
  const [rows, setRows] = useState<ScheduledRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    async function load() {
      setLoading(true)
      const res = await fetch("/api/admin/interview/schedule")
      if (!res.ok) {
        pushToast({ tone: "error", title: "Unable to load scheduled interviews" })
        setLoading(false)
        return
      }
      const { sessions } = (await res.json()) as { sessions: ScheduledRow[] }
      setRows(sessions ?? [])
      setLoading(false)
    }
    void load()
  }, [pushToast])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows
    return rows.filter(
      (row) =>
        row.userEmail?.toLowerCase().includes(query) ||
        row.userName?.toLowerCase().includes(query) ||
        row.jobTitle?.toLowerCase().includes(query) ||
        row.jobCompany?.toLowerCase().includes(query)
    )
  }, [rows, search])

  const next24h = rows.filter((r) => new Date(r.scheduledAt).getTime() - now <= DAY_MS)
  const next7d = rows.filter((r) => new Date(r.scheduledAt).getTime() - now <= 7 * DAY_MS)
  const distinctUsers = new Set(rows.map((r) => r.userId)).size
  const busiestSlot = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const key = new Date(row.scheduledAt).toISOString().slice(0, 13)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    let best: [string, number] | null = null
    for (const entry of counts.entries()) {
      if (!best || entry[1] > best[1]) best = entry
    }
    return best
  }, [rows])

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Interviews"
        title="Upcoming live interviews"
        description="Every scheduled live mock interview across all users — see when load is coming, who booked it, and whether reminders have gone out."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AdminStatCard
          label="Next 24 hours"
          value={formatNumber(next24h.length)}
          hint="Sessions starting within a day"
        />
        <AdminStatCard
          label="Next 7 days"
          value={formatNumber(next7d.length)}
          hint="Sessions starting within a week"
        />
        <AdminStatCard
          label="Total upcoming"
          value={formatNumber(rows.length)}
          hint="All future bookings"
        />
        <AdminStatCard
          label="Users with bookings"
          value={formatNumber(distinctUsers)}
          hint={
            busiestSlot
              ? `Busiest hour: ${new Date(`${busiestSlot[0]}:00:00Z`).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                })} UTC (${busiestSlot[1]})`
              : "No bookings yet"
          }
        />
      </div>

      <AdminPanel
        title="Scheduled sessions"
        description="Soonest first. Reminder count shows how many of the three reminder tiers have been delivered."
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <AdminInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search user, job, company…"
              className="pl-9"
            />
          </div>
        }
      >
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading scheduled interviews…
          </div>
        ) : visibleRows.length === 0 ? (
          <p className="py-10 text-center text-sm text-gray-500">
            {rows.length === 0
              ? "No upcoming scheduled interviews."
              : "No bookings match your search."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Target role</th>
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Reminders</th>
                  <th className="px-3 py-2">Booked</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 align-top">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="font-medium text-gray-900">
                        {formatDateTime(row.scheduledAt)}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        {countdownLabel(row.scheduledAt, now)}
                        {row.scheduledTimezone ? ` · ${row.scheduledTimezone}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-gray-900">
                        {row.userName ?? "—"}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">{row.userEmail ?? row.userId}</div>
                    </td>
                    <td className="px-3 py-3">
                      {row.jobTitle ? (
                        <>
                          <div className="text-gray-900">{row.jobTitle}</div>
                          {row.jobCompany && (
                            <div className="mt-0.5 text-xs text-gray-500">{row.jobCompany}</div>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-400">General practice</span>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-gray-700">
                      {row.durationTargetMin} min · {PERSONA_LABELS[row.persona] ?? row.persona}
                    </td>
                    <td className="px-3 py-3">
                      <AdminBadge tone={row.remindersSent > 0 ? "success" : "neutral"}>
                        {row.remindersSent}/3 sent
                      </AdminBadge>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-500">
                      {formatRelativeTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminPanel>
    </div>
  )
}
