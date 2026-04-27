"use client"

import { useCallback, useEffect, useState } from "react"
import type { AlertNotificationWithDetails } from "@/types"

export type NotificationFilter = "all" | "unread" | "alerts" | "watchlist"
export type LocalNotificationType = "resume" | "system"
export type LocalAppNotification = {
  id: string
  source: "local"
  notification_type: LocalNotificationType
  title: string
  message: string
  href: string | null
  tone: "info" | "success" | "error"
  sent_at: string
  opened_at: string | null
  clicked_at: string | null
}
export type AppNotification = AlertNotificationWithDetails | LocalAppNotification

const LOCAL_NOTIFICATION_EVENT = "hireoven:local-notification"
const LOCAL_NOTIFICATION_STORAGE_KEY = "hireoven:local-notifications"

function isLocalNotification(notification: AppNotification): notification is LocalAppNotification {
  return "source" in notification && notification.source === "local"
}

function readLocalNotifications() {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_NOTIFICATION_STORAGE_KEY) ?? "[]")
    return Array.isArray(parsed) ? parsed.slice(0, 50) as LocalAppNotification[] : []
  } catch {
    return []
  }
}

function writeLocalNotifications(notifications: LocalAppNotification[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(LOCAL_NOTIFICATION_STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)))
}

export function publishLocalNotification(input: {
  type?: LocalNotificationType
  title: string
  message: string
  href?: string | null
  tone?: LocalAppNotification["tone"]
}) {
  if (typeof window === "undefined") return

  const notification: LocalAppNotification = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    source: "local",
    notification_type: input.type ?? "system",
    title: input.title,
    message: input.message,
    href: input.href ?? null,
    tone: input.tone ?? "info",
    sent_at: new Date().toISOString(),
    opened_at: null,
    clicked_at: null,
  }

  const next = [notification, ...readLocalNotifications()]
  writeLocalNotifications(next)
  window.dispatchEvent(new CustomEvent(LOCAL_NOTIFICATION_EVENT, { detail: notification }))
}

export function useNotifications(
  userId?: string,
  filter: NotificationFilter = "all",
  pageSize = 20
) {
  const [serverNotifications, setServerNotifications] = useState<AlertNotificationWithDetails[]>([])
  const [localNotifications, setLocalNotifications] = useState<LocalAppNotification[]>([])
  const [serverUnreadCount, setServerUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  const filteredLocalNotifications = localNotifications.filter((notification) => {
    if (filter === "unread") return notification.opened_at == null
    if (filter === "alerts" || filter === "watchlist") return false
    return true
  })
  const notifications: AppNotification[] = [...filteredLocalNotifications, ...serverNotifications].sort(
    (left, right) => new Date(right.sent_at).getTime() - new Date(left.sent_at).getTime()
  )
  const unreadCount = serverUnreadCount + localNotifications.filter((notification) => notification.opened_at == null).length

  const fetchNotifications = useCallback(
    async (nextOffset = 0, append = false) => {
      if (!userId) {
        setServerNotifications([])
        setHasMore(false)
        setOffset(0)
        return
      }

      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          filter,
          limit: String(pageSize),
          offset: String(nextOffset),
        })
        const res = await fetch(`/api/notifications?${params}`)
        if (!res.ok) throw new Error("Failed to fetch notifications")

        const { notifications: rows, unreadCount: count } = (await res.json()) as {
          notifications: AlertNotificationWithDetails[]
          unreadCount: number
        }

        setServerNotifications((current) => (append ? [...current, ...rows] : rows))
        setOffset(nextOffset + rows.length)
        setHasMore(rows.length === pageSize)
        setServerUnreadCount(count)
      } finally {
        setIsLoading(false)
      }
    },
    [filter, pageSize, userId]
  )

  const refresh = useCallback(async () => {
    await fetchNotifications(0, false)
  }, [fetchNotifications])

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return
    await fetchNotifications(offset, true)
  }, [fetchNotifications, hasMore, isLoading, offset])

  const markAsRead = useCallback(
    async (notificationId: string, clicked = false) => {
      const timestamp = new Date().toISOString()

      if (notificationId.startsWith("local-")) {
        setLocalNotifications((current) => {
          const next = current.map((n) =>
            n.id === notificationId
              ? {
                  ...n,
                  opened_at: n.opened_at ?? timestamp,
                  clicked_at: clicked ? timestamp : n.clicked_at,
                }
              : n
          )
          writeLocalNotifications(next)
          return next
        })
        return
      }

      setServerNotifications((current) =>
        current.map((n) =>
          n.id === notificationId
            ? {
                ...n,
                opened_at: n.opened_at ?? timestamp,
                clicked_at: clicked ? timestamp : n.clicked_at,
              }
            : n
        )
      )
      setServerUnreadCount((current) => Math.max(0, current - 1))

      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notificationId }),
      })
    },
    []
  )

  const markAllRead = useCallback(async () => {
    if (!userId || unreadCount === 0) return

    const timestamp = new Date().toISOString()
    setServerNotifications((current) =>
      current.map((n) => ({ ...n, opened_at: n.opened_at ?? timestamp }))
    )
    setServerUnreadCount(0)
    setLocalNotifications((current) => {
      const next = current.map((n) => ({ ...n, opened_at: n.opened_at ?? timestamp }))
      writeLocalNotifications(next)
      return next
    })

    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    })
  }, [unreadCount, userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    setLocalNotifications(readLocalNotifications())

    function handleLocalNotification() {
      setLocalNotifications(readLocalNotifications())
    }

    window.addEventListener(LOCAL_NOTIFICATION_EVENT, handleLocalNotification)
    window.addEventListener("storage", handleLocalNotification)
    return () => {
      window.removeEventListener(LOCAL_NOTIFICATION_EVENT, handleLocalNotification)
      window.removeEventListener("storage", handleLocalNotification)
    }
  }, [])

  return {
    notifications,
    unreadCount,
    isLoading,
    hasMore,
    refresh,
    loadMore,
    markAsRead,
    markAllRead,
  }
}
