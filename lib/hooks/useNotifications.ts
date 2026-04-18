"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { AlertNotificationWithDetails } from "@/types"

export type NotificationFilter = "all" | "unread" | "alerts" | "watchlist"

function buildNotificationsQuery(userId: string, filter: NotificationFilter) {
  const supabase = createClient()

  let query = (supabase
    .from("alert_notifications")
    .select("*, job:jobs(*, company:companies(*)), alert:job_alerts(*)")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false }) as any)

  if (filter === "unread") {
    query = query.is("opened_at", null)
  }

  if (filter === "alerts") {
    query = query.eq("notification_type", "alert")
  }

  if (filter === "watchlist") {
    query = query.eq("notification_type", "watchlist")
  }

  return query
}

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

  const fetchUnreadCount = useCallback(async () => {
    if (!userId) {
      setUnreadCount(0)
      return
    }

    const supabase = createClient()
    const { count } = await (supabase
      .from("alert_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("opened_at", null) as any)

    setUnreadCount(count ?? 0)
  }, [userId])

  const fetchNotifications = useCallback(
    async (nextOffset = 0, append = false) => {
      if (!userId) {
        setNotifications([])
        setHasMore(false)
        setOffset(0)
        return
      }

      setIsLoading(true)
      const { data, error } = await buildNotificationsQuery(userId, filter).range(
        nextOffset,
        nextOffset + pageSize - 1
      )

      if (error) {
        setIsLoading(false)
        throw error
      }

      const rows = (data ?? []) as AlertNotificationWithDetails[]

      setNotifications((current) => (append ? [...current, ...rows] : rows))
      setOffset(nextOffset + rows.length)
      setHasMore(rows.length === pageSize)
      setIsLoading(false)
    },
    [filter, pageSize, userId]
  )

  const refresh = useCallback(async () => {
    await Promise.all([fetchNotifications(0, false), fetchUnreadCount()])
  }, [fetchNotifications, fetchUnreadCount])

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return
    await fetchNotifications(offset, true)
  }, [fetchNotifications, hasMore, isLoading, offset])

  const markAsRead = useCallback(
    async (notificationId: string, clicked = false) => {
      const timestamp = new Date().toISOString()
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? {
                ...notification,
                opened_at: notification.opened_at ?? timestamp,
                clicked_at: clicked ? timestamp : notification.clicked_at,
              }
            : notification
        )
      )

      setUnreadCount((current) => Math.max(0, current - 1))

      const supabase = createClient()
      await ((supabase.from("alert_notifications") as any)
        .update({
          opened_at: timestamp,
          ...(clicked ? { clicked_at: timestamp } : {}),
        } as any)
        .eq("id", notificationId))
    },
    []
  )

  const markAllRead = useCallback(async () => {
    if (!userId || unreadCount === 0) return

    const timestamp = new Date().toISOString()
    setNotifications((current) =>
      current.map((notification) => ({
        ...notification,
        opened_at: notification.opened_at ?? timestamp,
      }))
    )
    setUnreadCount(0)

    const supabase = createClient()
    await ((supabase.from("alert_notifications") as any)
      .update({ opened_at: timestamp } as any)
      .eq("user_id", userId)
      .is("opened_at", null))
  }, [unreadCount, userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!userId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`alert-notifications-${userId}-${filter}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alert_notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refresh()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [filter, refresh, userId])

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
