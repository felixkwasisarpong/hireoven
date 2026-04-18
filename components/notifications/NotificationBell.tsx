"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Bell, ChevronRight } from "lucide-react"
import { useNotifications } from "@/lib/hooks/useNotifications"

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

export default function NotificationBell({ userId }: { userId?: string }) {
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
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-[16px] border border-slate-200/80 bg-white text-gray-700 transition hover:border-[#FFD2B8] hover:text-[#062246]"
        aria-label="Open notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadLabel && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {unreadLabel}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-14 z-30 w-[360px] overflow-hidden rounded-[18px] border border-slate-200/80 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.14)]">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Notifications</p>
              <p className="text-xs text-gray-500">
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : "You're all caught up"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="text-xs font-medium text-[#062246] transition hover:text-[#FF5C18]"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm font-medium text-gray-900">No notifications yet</p>
                <p className="mt-1 text-xs text-gray-500">
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
                    if (notification.job?.apply_url) {
                      window.open(notification.job.apply_url, "_blank", "noopener,noreferrer")
                    }
                    setOpen(false)
                  }}
                  className="flex w-full items-start gap-3 border-b border-gray-100 px-5 py-4 text-left transition hover:bg-[#F8FBFF]"
                >
                  <div className="pt-1">
                    {notification.opened_at ? (
                      <span className="block h-2.5 w-2.5 rounded-full bg-transparent" />
                    ) : (
                      <span className="block h-2.5 w-2.5 rounded-full bg-[#FF5C18]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {notification.job?.title ?? "New job notification"}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {notification.job?.company?.name ?? "Tracked company"}
                      {" · "}
                      {notification.notification_type === "watchlist"
                        ? "Watchlist"
                        : notification.alert?.name ?? "Saved alert"}
                    </p>
                    <p className="mt-2 text-xs text-gray-400">
                      {formatRelative(notification.sent_at)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>

          <div className="flex items-center justify-between px-5 py-4">
            <Link
              href="/dashboard/notifications"
              className="inline-flex items-center gap-1 text-sm font-medium text-[#062246] transition hover:text-[#FF5C18]"
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
