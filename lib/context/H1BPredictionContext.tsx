"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { devWarn } from "@/lib/client-dev-log"
import type { H1BPrediction } from "@/types"

type PredictionState = {
  prediction: H1BPrediction | null
  isLoading: boolean
}

type ContextShape = {
  enabled: boolean
  register: (jobId: string) => void
  getState: (jobId: string) => PredictionState
}

const noop = () => {
  /* no-op */
}

const H1BPredictionContext = createContext<ContextShape>({
  enabled: false,
  register: noop,
  getState: () => ({ prediction: null, isLoading: false }),
})

const FLUSH_DEBOUNCE_MS = 120
const BATCH_SIZE = 20

// Shared across mounts within the tab.
const MEMORY_CACHE = new Map<string, H1BPrediction>()

export function H1BPredictionProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  const cacheRef = useRef<Map<string, H1BPrediction>>(new Map())
  const pendingRef = useRef<Set<string>>(new Set())
  const inFlightRef = useRef<Set<string>>(new Set())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, forceRender] = useState(0)

  const flush = useCallback(async () => {
    flushTimerRef.current = null
    if (pendingRef.current.size === 0) return

    const ids = Array.from(pendingRef.current)
    pendingRef.current.clear()

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE)
      for (const id of chunk) inFlightRef.current.add(id)

      try {
        const response = await fetch("/api/h1b/predict/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: chunk }),
        })
        if (!response.ok) {
          if (response.status !== 401 && response.status !== 503) {
            devWarn("h1b predict batch failed", response.statusText)
          }
          continue
        }
        const payload = (await response.json()) as {
          predictions?: Record<string, H1BPrediction>
        }
        for (const [id, prediction] of Object.entries(payload.predictions ?? {})) {
          cacheRef.current.set(id, prediction)
          MEMORY_CACHE.set(id, prediction)
        }
      } catch (err) {
        devWarn("h1b predict batch threw", err)
      } finally {
        for (const id of chunk) inFlightRef.current.delete(id)
        forceRender((n) => n + 1)
      }
    }
  }, [])

  const register = useCallback(
    (jobId: string) => {
      if (!enabled || !jobId) return
      if (cacheRef.current.has(jobId)) return
      if (inFlightRef.current.has(jobId)) return
      if (MEMORY_CACHE.has(jobId)) {
        cacheRef.current.set(jobId, MEMORY_CACHE.get(jobId)!)
        forceRender((n) => n + 1)
        return
      }

      pendingRef.current.add(jobId)
      if (flushTimerRef.current) return
      flushTimerRef.current = setTimeout(() => {
        void flush()
      }, FLUSH_DEBOUNCE_MS)
    },
    [enabled, flush]
  )

  useEffect(
    () => () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
    },
    []
  )

  const getState = useCallback(
    (jobId: string): PredictionState => ({
      prediction: cacheRef.current.get(jobId) ?? null,
      isLoading:
        !cacheRef.current.has(jobId) &&
        (pendingRef.current.has(jobId) || inFlightRef.current.has(jobId)),
    }),
    []
  )

  const value = useMemo<ContextShape>(
    () => ({ enabled, register, getState }),
    [enabled, register, getState]
  )

  return (
    <H1BPredictionContext.Provider value={value}>
      {children}
    </H1BPredictionContext.Provider>
  )
}

export function useH1BPrediction(jobId: string | null) {
  const { enabled, register, getState } = useContext(H1BPredictionContext)
  const ref = useRef<HTMLElement | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [state, setState] = useState<PredictionState>({
    prediction: null,
    isLoading: false,
  })

  // Only register once, when the card first becomes visible.
  useEffect(() => {
    if (!enabled || !jobId) return
    if (isVisible) register(jobId)
  }, [enabled, isVisible, jobId, register])

  // Poll for state changes. Cheap - provider forceRenders on each batch return.
  useEffect(() => {
    if (!enabled || !jobId) return
    setState(getState(jobId))
  }, [enabled, jobId, getState])

  // Pull fresh on every render of the parent provider.
  const liveState = enabled && jobId ? getState(jobId) : state

  const attachRef = useCallback(
    (node: HTMLElement | null) => {
      if (!enabled || !jobId) {
        ref.current = null
        return
      }
      if (ref.current === node) return
      ref.current = node
      if (!node || typeof IntersectionObserver === "undefined") return
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              setIsVisible(true)
              observer.disconnect()
              break
            }
          }
        },
        { rootMargin: "200px 0px" }
      )
      observer.observe(node)
    },
    [enabled, jobId]
  )

  return {
    enabled,
    attachRef,
    prediction: liveState.prediction,
    isLoading: liveState.isLoading,
  }
}
