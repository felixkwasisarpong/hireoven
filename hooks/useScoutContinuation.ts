"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  isEmptyContinuationState,
  sanitizeContinuationState,
  serializeContinuationState,
} from "@/lib/scout/continuation/sanitize"
import {
  clearContinuationState,
  readContinuationState,
  writeContinuationState,
} from "@/lib/scout/continuation/store"
import type {
  ScoutContinuationApiResponse,
  ScoutContinuationState,
} from "@/lib/scout/continuation/types"

type UseScoutContinuationOptions = {
  enabled?: boolean
  syncDebounceMs?: number
}

type UseScoutContinuationResult = {
  state: ScoutContinuationState | null
  loading: boolean
  hydrated: boolean
  syncPending: boolean
  error: string | null
  save: (state: ScoutContinuationState) => void
  clear: () => void
  refresh: () => Promise<void>
}

export function useScoutContinuation({
  enabled = true,
  syncDebounceMs = 1_200,
}: UseScoutContinuationOptions = {}): UseScoutContinuationResult {
  const [state, setState] = useState<ScoutContinuationState | null>(null)
  const [loading, setLoading] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const [syncPending, setSyncPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queuedSyncRef = useRef<ScoutContinuationState | null | undefined>(undefined)
  const lastSerializedRef = useRef("")
  const localSavedAtRef = useRef<number>(0)

  const flushSync = useCallback(async () => {
    if (!enabled) return

    const queued = queuedSyncRef.current
    if (queued === undefined) return

    try {
      await fetch("/api/scout/continuation", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ state: queued }),
      })
      setError(null)
    } catch {
      setError("Could not sync continuation state")
    } finally {
      queuedSyncRef.current = undefined
      setSyncPending(false)
    }
  }, [enabled])

  const scheduleSync = useCallback((next: ScoutContinuationState | null) => {
    if (!enabled) return
    queuedSyncRef.current = next
    setSyncPending(true)

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
    }

    syncTimerRef.current = setTimeout(() => {
      void flushSync()
    }, syncDebounceMs)
  }, [enabled, flushSync, syncDebounceMs])

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false)
      setHydrated(true)
      return
    }

    try {
      setLoading(true)
      const res = await fetch("/api/scout/continuation", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })

      if (!res.ok) {
        throw new Error(`Continuation GET failed (${res.status})`)
      }

      const data = (await res.json().catch(() => null)) as ScoutContinuationApiResponse | null
      const remoteState = data?.state ? sanitizeContinuationState(data.state) : null
      const remoteUpdatedAtMs = data?.updatedAt ? new Date(data.updatedAt).getTime() : 0

      if (!remoteState || isEmptyContinuationState(remoteState)) {
        return
      }

      if (remoteUpdatedAtMs >= localSavedAtRef.current) {
        setState(remoteState)
        writeContinuationState(remoteState)
        localSavedAtRef.current = remoteUpdatedAtMs || Date.now()
        lastSerializedRef.current = serializeContinuationState(remoteState)
      }
    } catch {
      setError("Could not load continuation state")
    } finally {
      setLoading(false)
      setHydrated(true)
    }
  }, [enabled])

  useEffect(() => {
    const local = readContinuationState()
    if (local.state) {
      const clean = sanitizeContinuationState(local.state)
      if (!isEmptyContinuationState(clean)) {
        setState(clean)
        lastSerializedRef.current = serializeContinuationState(clean)
      }
    }
    localSavedAtRef.current = local.savedAt ?? 0

    void refresh()

    return () => {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current)
      }
    }
  }, [refresh])

  const save = useCallback((nextState: ScoutContinuationState) => {
    const clean = sanitizeContinuationState(nextState)
    if (isEmptyContinuationState(clean)) return

    const serialized = serializeContinuationState(clean)
    if (serialized === lastSerializedRef.current) return

    lastSerializedRef.current = serialized
    setState(clean)
    writeContinuationState(clean)
    localSavedAtRef.current = Date.now()

    scheduleSync(clean)
  }, [scheduleSync])

  const clear = useCallback(() => {
    setState(null)
    setError(null)
    setSyncPending(false)
    lastSerializedRef.current = ""
    localSavedAtRef.current = Date.now()
    clearContinuationState()

    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }

    scheduleSync(null)
  }, [scheduleSync])

  return {
    state,
    loading,
    hydrated,
    syncPending,
    error,
    save,
    clear,
    refresh,
  }
}
