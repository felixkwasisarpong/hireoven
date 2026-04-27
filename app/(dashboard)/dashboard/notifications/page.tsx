"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BellRing } from "lucide-react"
import { useNotifications, type AppNotification, type LocalAppNotification, type NotificationFilter } from "@/lib/hooks/useNotifications"
import { useAuth } from "@/lib/hooks/useAuth"
import type { AlertNotificationWithDetails } from "@/types"

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

function isLocalNotification(notification: AppNotification): notification is LocalAppNotification {
  return "source" in notification && notification.source === "local"
}

function isServerNotification(notification: AppNotification): notification is AlertNotificationWithDetails {
  return !isLocalNotification(notification)
}

function notificationCategory(notification: AppNotification) {
  if (isLocalNotification(notification)) return notification.notification_type === "resume" ? "Resume" : "System"
  if (!isServerNotification(notification)) return "System"
  return notification.notification_type === "watchlist"
    ? "Watchlist"
    : notification.alert?.name ?? "Saved alert"
}

function notificationTitle(notification: AppNotification) {
  if (isLocalNotification(notification)) return notification.title
  return notification.job?.title ?? "New job notification"
}

function notificationDescription(notification: AppNotification) {
  if (isLocalNotification(notification)) return notification.message
  if (!isServerNotification(notification)) return ""
  return `${notification.job?.company?.name ?? "Tracked company"}${
    notification.job?.location
      ? ` · ${notification.job.location}`
      : notification.job?.is_remote
        ? " · Remote"
        : ""
  }`
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
    <main className="app-page">
      <div className="app-shell max-w-6xl space-y-6 px-4 pb-10 pt-1 sm:px-6 lg:px-8">
        <section className="surface-hero rounded-xl p-5 sm:p-6 md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="section-kicker">Notifications</p>
              <h1 className="section-title mt-3">
                Everything Hireoven has flagged for you
              </h1>
              <p className="section-copy mt-3 max-w-2xl">
                Review every recent alert and watchlist update in one place, then
                jump back into the jobs that matter.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-3 lg:justify-end">
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
              >
                Mark all read
              </button>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-2xl bg-[#FF5C18] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </section>

        <section className="surface-card rounded-xl p-5 sm:p-6 md:p-8">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                className={`chip-control ${filter === item.value ? "chip-control-active" : ""}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between border-b border-border pb-4">
            <p className="text-sm font-medium text-gray-600">
              {title} notifications
              {unreadCount > 0 ? ` · ${unreadCount} unread` : ""}
            </p>
          </div>

          {notifications.length === 0 && !isLoading ? (
            <div className="empty-state mt-8 rounded-xl">
              <BellRing className="mx-auto h-10 w-10 text-[#FF5C18]" />
              <h2 className="mt-4 text-2xl font-semibold text-gray-900">
                No notifications yet
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
                Once alerts start matching or watched companies post fresh jobs,
                they will show up here instantly.
              </p>
            </div>
          ) : (
            <div className="mt-8 space-y-4">
              {notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    void markAsRead(notification.id, true)
                    if (isLocalNotification(notification) && notification.href) {
                      window.location.href = notification.href
                    } else if (isServerNotification(notification) && notification.job?.apply_url) {
                      window.open(notification.job.apply_url, "_blank", "noopener,noreferrer")
                    }
                  }}
                  className="data-list-row w-full p-5 text-left transition hover:-translate-y-0.5 hover:border-[#FFD2B8] hover:shadow-[0_16px_40px_rgba(15,23,42,0.08)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {!notification.opened_at && (
                          <span className="h-2.5 w-2.5 rounded-full bg-[#FF5C18]" />
                        )}
                        <span className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                          {notificationCategory(notification)}
                        </span>
                      </div>
                      <h2 className="mt-3 text-lg font-semibold text-gray-900">
                        {notificationTitle(notification)}
                      </h2>
                      <p className="mt-2 text-sm text-gray-500">
                        {notificationDescription(notification)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">
                        {formatRelative(notification.sent_at)}
                      </p>
                      <p className="mt-2 text-xs font-medium text-[#062246]">
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
