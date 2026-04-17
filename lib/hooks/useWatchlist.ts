"use client"

import { useCallback, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import type { Company, WatchlistWithCompany } from "@/types"

export function useWatchlist(userId?: string) {
  const [watchlist, setWatchlist] = useState<WatchlistWithCompany[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!userId) {
      setWatchlist([])
      return
    }

    setIsLoading(true)
    const supabase = createClient()
    const { data } = await (supabase
      .from("watchlist")
      .select("*, company:companies(*)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }) as any)

    setWatchlist((data as WatchlistWithCompany[]) ?? [])
    setIsLoading(false)
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

      const supabase = createClient()
      const { data: company } = await supabase
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .single()

      if (!company) return

      const optimistic: WatchlistWithCompany = {
        id: `optimistic-${companyId}`,
        user_id: userId,
        company_id: companyId,
        created_at: new Date().toISOString(),
        company: company as Company,
      }

      setWatchlist((current) => [optimistic, ...current])

      const { data, error } = await ((supabase.from("watchlist") as any)
        .insert({ user_id: userId, company_id: companyId })
        .select("*, company:companies(*)")
        .single())

      if (error) {
        setWatchlist((current) =>
          current.filter((item) => item.company_id !== companyId)
        )
        return
      }

      if (data) {
        setWatchlist((current) =>
          current.map((item) =>
            item.company_id === companyId
              ? (data as WatchlistWithCompany)
              : item
          )
        )
      }
    },
    [isWatching, userId]
  )

  const removeCompany = useCallback(
    async (companyId: string) => {
      if (!userId) return

      const snapshot = watchlist
      setWatchlist((current) =>
        current.filter((item) => item.company_id !== companyId)
      )

      const supabase = createClient()
      const { error } = await supabase
        .from("watchlist")
        .delete()
        .eq("user_id", userId)
        .eq("company_id", companyId)

      if (error) setWatchlist(snapshot)
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
