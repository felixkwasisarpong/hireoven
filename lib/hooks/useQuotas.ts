"use client"

import { useCallback, useEffect, useState } from "react"
import type { Plan } from "@/lib/gates"
import type { MeteredFeature, QuotaConfig, QuotaState } from "@/lib/usage/quotas"

type QuotasResponse = {
  plan: Plan
  quotas: Record<MeteredFeature, QuotaState>
  config: Record<MeteredFeature, QuotaConfig>
  packBalances?: Record<MeteredFeature, number>
}

export type UseQuotasResult = {
  quotas: Record<MeteredFeature, QuotaState> | null
  config: Record<MeteredFeature, QuotaConfig> | null
  packBalances: Record<MeteredFeature, number> | null
  plan: Plan | null
  isLoading: boolean
  refresh: () => void
}

export function useQuotas(): UseQuotasResult {
  const [data, setData] = useState<QuotasResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetch("/api/usage/quotas", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!cancelled) setData(json)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const refresh = useCallback(() => setReloadToken((n) => n + 1), [])

  return {
    quotas: data?.quotas ?? null,
    config: data?.config ?? null,
    packBalances: data?.packBalances ?? null,
    plan: data?.plan ?? null,
    isLoading,
    refresh,
  }
}
