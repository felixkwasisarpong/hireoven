"use client"

import { useCallback, useEffect, useState } from "react"
import type { AlertNotificationWithDetails } from "@/types"

export type NotificationFilter = "all" | "unread" | "alerts" | "watchlist"

export function useNotifications(
  userId?: string,
  filter: NotificationFilter = "all",
  pageSize = 20
) {
  const [notifications, setNotifications] = useState<AlertNotificationWithDetails[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)

  const fetchNotifications = useCallback(
    async (nextOffset = 0, append = false) => {
      if (!userId) {
        setNotifications([])
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

        setNotifications((current) => (append ? [...current, ...rows] : rows))
        setOffset(nextOffset + rows.length)
        setHasMore(rows.length === pageSize)
        setUnreadCount(count)
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
      setNotifications((current) =>
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
      setUnreadCount((current) => Math.max(0, current - 1))

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
    setNotifications((current) =>
      current.map((n) => ({ ...n, opened_at: n.opened_at ?? timestamp }))
    )
    setUnreadCount(0)

    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    })
  }, [unreadCount, userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
