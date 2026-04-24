"use client"

import { useCallback, useEffect, useState } from "react"
import type { WatchlistWithCompany } from "@/types"

export function useWatchlist(userId?: string) {
  const [watchlist, setWatchlist] = useState<WatchlistWithCompany[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) {
      setWatchlist([])
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch("/api/watchlist")
      if (res.ok) {
        const { watchlist: rows } = (await res.json()) as { watchlist: WatchlistWithCompany[] }
        setWatchlist(rows)
      }
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const isWatching = useCallback(
    (companyId: string) => watchlist.some((item) => item.company_id === companyId),
    [watchlist]
  )

  const addCompany = useCallback(
    async (companyId: string) => {
      if (!userId || isWatching(companyId)) return

      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })

      if (res.ok) {
        await refresh()
      }
    },
    [isWatching, refresh, userId]
  )

  const removeCompany = useCallback(
    async (companyId: string) => {
      if (!userId) return

      const snapshot = watchlist
      setWatchlist((current) =>
        current.filter((item) => item.company_id !== companyId)
      )

      const res = await fetch(`/api/watchlist?companyId=${encodeURIComponent(companyId)}`, {
        method: "DELETE",
      })

      if (!res.ok) setWatchlist(snapshot)
    },
    [userId, watchlist]
  )

  return {
    watchlist,
    isLoading,
    refresh,
    addCompany,
    removeCompany,
    isWatching,
  }
}
