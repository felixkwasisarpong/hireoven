"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Bell, ChevronRight } from "lucide-react"
import { useNotifications, type AppNotification, type LocalAppNotification } from "@/lib/hooks/useNotifications"
import { cn } from "@/lib/utils"

function formatRelative(timestamp: string) {
  const diffMinutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
  )

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}

function isLocalNotification(notification: AppNotification): notification is LocalAppNotification {
  return "source" in notification && notification.source === "local"
}

function notificationTitle(notification: AppNotification) {
  return isLocalNotification(notification)
    ? notification.title
    : notification.job?.title ?? "New job notification"
}

function notificationDescription(notification: AppNotification) {
  if (isLocalNotification(notification)) return notification.message
  return `${notification.job?.company?.name ?? "Tracked company"} · ${
    notification.notification_type === "watchlist"
      ? "Watchlist"
      : notification.alert?.name ?? "Saved alert"
  }`
}

export default function NotificationBell({
  userId,
  badgeVariant = "red",
  buttonClassName,
}: {
  userId?: string
  /** `product` = blue badge (dashboard job feed mockup). */
  badgeVariant?: "red" | "product"
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { notifications, unreadCount, markAllRead, markAsRead } = useNotifications(
    userId,
    "all",
    10
  )

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const unreadLabel = useMemo(() => {
    if (unreadCount <= 0) return null
    if (unreadCount > 99) return "99+"
    return unreadCount.toString()
  }, [unreadCount])

  if (!userId) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#D7DCEA] bg-white text-slate-700 transition hover:border-[#B9C3DE] hover:bg-[#F6F8FD] hover:text-slate-900",
          unreadCount > 0 && "text-[#2563EB] ring-2 ring-[#2563EB]/15",
          buttonClassName
        )}
        aria-label="Open notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadLabel && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-white",
              badgeVariant === "product"
                ? "bg-[#2563EB]"
                : "bg-red-500 shadow-[0_8px_14px_-8px_rgba(239,68,68,0.85)]"
            )}
          >
            {unreadLabel}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-[360px] overflow-hidden rounded-2xl border border-[#D7DCEA] bg-white shadow-[0_22px_56px_-32px_rgba(20,30,70,0.5)]">
          <div className="flex items-center justify-between border-b border-border/80 bg-gradient-to-r from-cyan-50/70 via-sky-50/60 to-orange-50/65 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Notifications</p>
              <p className="text-xs text-slate-500">
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : "You're all caught up"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="text-xs font-medium text-sky-900 transition hover:text-[#FF5C18]"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-slate-900">No notifications yet</p>
                <p className="mt-1 text-xs text-slate-500">
                  New job matches and watchlist updates will show up here.
                </p>
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => {
                    void markAsRead(notification.id, true)
                    if (isLocalNotification(notification) && notification.href) {
                      window.location.href = notification.href
                    } else if (!isLocalNotification(notification) && notification.job?.apply_url) {
                      window.open(notification.job.apply_url, "_blank", "noopener,noreferrer")
                    }
                    setOpen(false)
                  }}
                  className="flex w-full items-start gap-3 border-b border-border/70 px-5 py-4 text-left transition hover:bg-cyan-50/55"
                >
                  <div className="pt-1">
                    {notification.opened_at ? (
                      <span className="block h-2.5 w-2.5 rounded-full bg-transparent" />
                    ) : (
                      <span className="block h-2.5 w-2.5 rounded-full bg-[#FF5C18]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">
                      {notificationTitle(notification)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {notificationDescription(notification)}
                    </p>
                    <p className="mt-2 text-xs text-slate-400">
                      {formatRelative(notification.sent_at)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border/70 bg-white/80 px-5 py-4">
            <Link
              href="/dashboard/notifications"
              className="inline-flex items-center gap-1 text-sm font-medium text-sky-900 transition hover:text-[#FF5C18]"
              onClick={() => setOpen(false)}
            >
              View all
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
