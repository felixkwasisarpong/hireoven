"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BellRing } from "lucide-react"
import { useNotifications, type NotificationFilter } from "@/lib/hooks/useNotifications"
import { useAuth } from "@/lib/hooks/useAuth"

const FILTERS: Array<{ value: NotificationFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "alerts", label: "Alerts" },
  { value: "watchlist", label: "Watchlist" },
]

function formatRelative(timestamp: string) {
  const diffMinutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
  )

  if (diffMinutes < 60) return `${diffMinutes} min ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const [filter, setFilter] = useState<NotificationFilter>("all")
  const { notifications, unreadCount, isLoading, hasMore, loadMore, markAllRead, markAsRead } =
    useNotifications(user?.id, filter, 20)

  const title = useMemo(() => {
    const currentFilter = FILTERS.find((item) => item.value === filter)
    return currentFilter?.label ?? "All"
  }, [filter])

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_58%,#F8FAFC_100%)] px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <section className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#0369A1]">
                Notifications
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
                Everything Hireoven has flagged for you
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
                Review every recent alert and watchlist update in one place, then
                jump back into the jobs that matter.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                Mark all read
              </button>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985]"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  filter === item.value
                    ? "bg-[#F0F9FF] text-[#0C4A6E]"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {title} notifications
              {unreadCount > 0 ? ` · ${unreadCount} unread` : ""}
            </p>
          </div>

          {notifications.length === 0 && !isLoading ? (
            <div className="rounded-[24px] border border-dashed border-gray-300 px-6 py-14 text-center">
              <BellRing className="mx-auto h-10 w-10 text-[#0369A1]" />
              <h2 className="mt-4 text-2xl font-semibold text-gray-900">
                No notifications yet
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
                Once alerts start matching or watched companies post fresh jobs,
                they will show up here instantly.
              </p>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    void markAsRead(notification.id, true)
                    if (notification.job?.apply_url) {
                      window.open(notification.job.apply_url, "_blank", "noopener,noreferrer")
                    }
                  }}
                  className="w-full rounded-[24px] border border-gray-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-[#BAE6FD] hover:shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {!notification.opened_at && (
                          <span className="h-2.5 w-2.5 rounded-full bg-[#0369A1]" />
                        )}
                        <span className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                          {notification.notification_type === "watchlist"
                            ? "Watchlist"
                            : notification.alert?.name ?? "Saved alert"}
                        </span>
                      </div>
                      <h2 className="mt-3 text-lg font-semibold text-gray-900">
                        {notification.job?.title ?? "New job notification"}
                      </h2>
                      <p className="mt-2 text-sm text-gray-500">
                        {notification.job?.company?.name ?? "Tracked company"}
                        {notification.job?.location
                          ? ` · ${notification.job.location}`
                          : notification.job?.is_remote
                            ? " · Remote"
                            : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">
                        {formatRelative(notification.sent_at)}
                      </p>
                      <p className="mt-2 text-xs font-medium text-[#0C4A6E]">
                        Open job
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                className="inline-flex items-center justify-center rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                Load more
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
