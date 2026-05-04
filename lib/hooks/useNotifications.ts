"use client"

import { useCallback, useEffect, useState } from "react"
import type { AlertNotificationWithDetails } from "@/types"

export type NotificationFilter = "all" | "unread" | "alerts" | "watchlist"
export type LocalNotificationType =
  | "resume"
  | "system"
  | "job_match"
  | "visa"
  | "risk"
  | "autofill"
  | "application"
export type LocalNotificationTagTone = "neutral" | "info" | "success" | "warning" | "danger"
export type LocalNotificationTag = {
  label: string
  tone?: LocalNotificationTagTone
}
export type LocalNotificationContext = {
  source?: "hireoven" | "linkedin" | "glassdoor" | "system"
  jobId?: string
  company?: string
  matchScore?: number | null
  sponsorshipScore?: number | null
  ghostRisk?: "low" | "medium" | "high" | "unknown" | null
}
export type LocalAppNotification = {
  id: string
  source: "local"
  notification_type: LocalNotificationType
  title: string
  message: string
  href: string | null
  tone: "info" | "success" | "error"
  tags?: LocalNotificationTag[]
  context?: LocalNotificationContext
  sent_at: string
  opened_at: string | null
  clicked_at: string | null
}
export type AppNotification = AlertNotificationWithDetails | LocalAppNotification

const LOCAL_NOTIFICATION_EVENT = "hireoven:local-notification"
const LOCAL_NOTIFICATION_STORAGE_KEY = "hireoven:local-notifications"
const LOCAL_NOTIFICATION_SEEN_KEY = "hireoven:local-notifications-seen"
const LOCAL_NOTIFICATION_TYPES: LocalNotificationType[] = [
  "resume",
  "system",
  "job_match",
  "visa",
  "risk",
  "autofill",
  "application",
]

export function isLocalNotification(notification: AppNotification): notification is LocalAppNotification {
  return "source" in notification && notification.source === "local"
}

function normalizeLocalNotificationType(value: unknown): LocalNotificationType {
  if (typeof value === "string" && LOCAL_NOTIFICATION_TYPES.includes(value as LocalNotificationType)) {
    return value as LocalNotificationType
  }
  return "system"
}

function normalizeLocalNotification(row: unknown): LocalAppNotification | null {
  if (!row || typeof row !== "object") return null
  const n = row as Partial<LocalAppNotification>
  if (!n.id || !n.title || !n.message || !n.sent_at) return null

  const tone: LocalAppNotification["tone"] =
    n.tone === "success" || n.tone === "error" ? n.tone : "info"

  const notification: LocalAppNotification = {
    id: String(n.id),
    source: "local",
    notification_type: normalizeLocalNotificationType(n.notification_type),
    title: String(n.title),
    message: String(n.message),
    href: typeof n.href === "string" ? n.href : null,
    tone,
    sent_at: String(n.sent_at),
    opened_at: typeof n.opened_at === "string" ? n.opened_at : null,
    clicked_at: typeof n.clicked_at === "string" ? n.clicked_at : null,
  }

  if (Array.isArray(n.tags)) {
    const tags = n.tags
      .filter((tag): tag is LocalNotificationTag => (
        Boolean(tag) &&
        typeof tag === "object" &&
        typeof (tag as LocalNotificationTag).label === "string" &&
        (tag as LocalNotificationTag).label.trim().length > 0
      ))
      .slice(0, 4)
    if (tags.length > 0) notification.tags = tags
  }

  if (n.context && typeof n.context === "object") {
    notification.context = n.context as LocalNotificationContext
  }

  return notification
}

function readLocalNotifications() {
  if (typeof window === "undefined") return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_NOTIFICATION_STORAGE_KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, 50).map(normalizeLocalNotification).filter((row): row is LocalAppNotification => row !== null)
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
  tags?: LocalNotificationTag[]
  context?: LocalNotificationContext
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
    tags: input.tags?.slice(0, 4),
    context: input.context,
    sent_at: new Date().toISOString(),
    opened_at: null,
    clicked_at: null,
  }

  const next = [notification, ...readLocalNotifications()]
  writeLocalNotifications(next)
  window.dispatchEvent(new CustomEvent(LOCAL_NOTIFICATION_EVENT, { detail: notification }))
}

function readLocalNotificationSeen(): Record<string, number> {
  if (typeof window === "undefined") return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_NOTIFICATION_SEEN_KEY) ?? "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => (
        typeof entry[0] === "string" &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1])
      ))
    )
  } catch {
    return {}
  }
}

function writeLocalNotificationSeen(seen: Record<string, number>) {
  if (typeof window === "undefined") return
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 21
  const compact = Object.fromEntries(
    Object.entries(seen)
      .filter(([, ts]) => ts >= cutoff)
      .slice(-400)
  )
  window.localStorage.setItem(LOCAL_NOTIFICATION_SEEN_KEY, JSON.stringify(compact))
}

export function publishLocalNotificationOnce(input: {
  dedupeKey: string
  cooldownMinutes?: number
  type?: LocalNotificationType
  title: string
  message: string
  href?: string | null
  tone?: LocalAppNotification["tone"]
  tags?: LocalNotificationTag[]
  context?: LocalNotificationContext
}) {
  if (typeof window === "undefined") return false
  const dedupeKey = input.dedupeKey.trim()
  if (!dedupeKey) return false

  const seen = readLocalNotificationSeen()
  const now = Date.now()
  const cooldownMs = Math.max(1, input.cooldownMinutes ?? 60) * 60_000
  const lastSeen = seen[dedupeKey]
  if (typeof lastSeen === "number" && now - lastSeen < cooldownMs) return false

  publishLocalNotification({
    type: input.type,
    title: input.title,
    message: input.message,
    href: input.href,
    tone: input.tone,
    tags: input.tags,
    context: input.context,
  })

  seen[dedupeKey] = now
  writeLocalNotificationSeen(seen)
  return true
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
