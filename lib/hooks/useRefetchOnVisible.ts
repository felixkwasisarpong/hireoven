"use client"

import { useEffect, useRef } from "react"

/**
 * Run `onRefresh` when the tab returns to the foreground after being away —
 * but only if at least `staleMs` has elapsed since the last refresh — so a
 * feed left open in a background tab catches up to "now" when the user comes
 * back, without refetching on every quick alt-tab.
 *
 * The freshness window the feed shows drifts over time (e.g. a "last 24h"
 * match feed), and new jobs arrive while the tab sits idle; this keeps a
 * long-open feed current without a manual refresh.
 *
 * Returns `markFresh()` — call it after loading data through another path
 * (initial load, filter change) so the staleness clock stays in sync and the
 * next tab-return doesn't immediately refetch.
 */
export function useRefetchOnVisible(onRefresh: () => void, staleMs = 60_000): () => void {
  const lastRunRef = useRef(Date.now())
  const cbRef = useRef(onRefresh)
  cbRef.current = onRefresh

  useEffect(() => {
    function maybeRefresh() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return
      if (Date.now() - lastRunRef.current < staleMs) return
      lastRunRef.current = Date.now()
      cbRef.current()
    }
    document.addEventListener("visibilitychange", maybeRefresh)
    window.addEventListener("focus", maybeRefresh)
    return () => {
      document.removeEventListener("visibilitychange", maybeRefresh)
      window.removeEventListener("focus", maybeRefresh)
    }
  }, [staleMs])

  // Stable across renders; resets the clock after a non-focus load.
  const markFreshRef = useRef(() => {
    lastRunRef.current = Date.now()
  })
  return markFreshRef.current
}
