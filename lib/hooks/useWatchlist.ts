"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { WatchlistWithCompany } from "@/types"

type UseWatchlistOptions = {
  authLoading?: boolean
  initialWatchlist?: WatchlistWithCompany[]
  initialLoaded?: boolean
}

export function useWatchlist(userId?: string, options: UseWatchlistOptions = {}) {
  const authLoading = options.authLoading === true
  const hasInitial = options.initialLoaded === true
  const [watchlist, setWatchlist] = useState<WatchlistWithCompany[]>(options.initialWatchlist ?? [])
  const [isLoading, setIsLoading] = useState(hasInitial ? false : authLoading)
  const skipInitialRefreshRef = useRef(hasInitial)

  const refresh = useCallback(async () => {
    if (!userId) {
      if (authLoading) {
        setIsLoading(true)
        return
      }
      setWatchlist([])
      setIsLoading(false)
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
  }, [userId, authLoading])

  useEffect(() => {
    if (skipInitialRefreshRef.current) {
      skipInitialRefreshRef.current = false
      if (!authLoading) setIsLoading(false)
      return
    }
    void refresh()
  }, [refresh, authLoading])

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
