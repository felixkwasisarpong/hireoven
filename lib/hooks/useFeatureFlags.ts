"use client"

import { useEffect, useState } from "react"

export type PublicFeatureFlags = {
  paymentsDisabled: boolean
  maintenanceBanner: { enabled: boolean; message: string }
}

const DEFAULT: PublicFeatureFlags = {
  paymentsDisabled: false,
  maintenanceBanner: { enabled: false, message: "" },
}

/**
 * Module-level cache so multiple components mounting in the same session
 * share one fetch. The /api/public/feature-flags endpoint is force-dynamic
 * server-side, so a single fetch per page navigation is enough.
 */
let cachedPromise: Promise<PublicFeatureFlags> | null = null

function fetchFlags(): Promise<PublicFeatureFlags> {
  if (cachedPromise) return cachedPromise
  cachedPromise = fetch("/api/public/feature-flags", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : DEFAULT))
    .catch(() => DEFAULT)
  return cachedPromise
}

export function useFeatureFlags(): PublicFeatureFlags {
  const [flags, setFlags] = useState<PublicFeatureFlags>(DEFAULT)
  useEffect(() => {
    let alive = true
    fetchFlags().then((value) => {
      if (alive) setFlags(value)
    })
    return () => {
      alive = false
    }
  }, [])
  return flags
}
