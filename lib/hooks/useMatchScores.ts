"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { devWarn } from "@/lib/client-dev-log"
import { createClient } from "@/lib/supabase/client"
import type { JobMatchScore } from "@/types"

type CacheEnvelope = {
  expiresAt: number
  scores: Record<string, JobMatchScore>
}

const MEMORY_CACHE = new Map<string, JobMatchScore>()
const ONE_HOUR_MS = 60 * 60 * 1_000

function getSessionKey(userId: string) {
  return `match_scores_${userId}`
}

function readSessionCache(userId: string) {
  if (typeof window === "undefined") return {}

  try {
    const raw = window.sessionStorage.getItem(getSessionKey(userId))
    if (!raw) return {}

    const parsed = JSON.parse(raw) as CacheEnvelope
    if (!parsed.expiresAt || parsed.expiresAt < Date.now()) {
      window.sessionStorage.removeItem(getSessionKey(userId))
      return {}
    }

    return parsed.scores ?? {}
  } catch {
    return {}
  }
}

function writeSessionCache(userId: string, scores: Record<string, JobMatchScore>) {
  if (typeof window === "undefined") return

  const envelope: CacheEnvelope = {
    expiresAt: Date.now() + ONE_HOUR_MS,
    scores,
  }

  window.sessionStorage.setItem(getSessionKey(userId), JSON.stringify(envelope))
}

export function useMatchScores(jobIds: string[]) {
  const scoresRef = useRef<Map<string, JobMatchScore>>(new Map())
  const [userId, setUserId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [, forceRender] = useState(0)

  // Parent often passes `jobs.map((j) => j.id)` - new array reference every render. Key on content, not reference.
  const jobIdsFingerprint = jobIds.join("\0")
  const uniqueJobIds = useMemo(
    () => Array.from(new Set(jobIds.filter(Boolean))),
    [jobIdsFingerprint]
  )

  useEffect(() => {
    let cancelled = false

    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (cancelled) return
        setUserId(data.user?.id ?? null)
      })
      .catch((error) => {
        devWarn("Failed to load match score user", error)
        if (!cancelled) setUserId(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!userId) return

    const cached = readSessionCache(userId)
    for (const [jobId, score] of Object.entries(cached)) {
      MEMORY_CACHE.set(`${userId}:${jobId}`, score)
      scoresRef.current.set(jobId, score)
    }

    forceRender((current) => current + 1)
  }, [userId])

  const persist = useCallback(() => {
    if (!userId) return

    const nextEntries = Object.fromEntries(
      Array.from(scoresRef.current.entries()).map(([jobId, score]) => [jobId, score])
    )
    writeSessionCache(userId, nextEntries)
  }, [userId])

  const loadScores = useCallback(
    async (requestedJobIds: string[]) => {
      if (!userId || requestedJobIds.length === 0) return

      const missingJobIds = requestedJobIds.filter((jobId) => {
        const existing = scoresRef.current.get(jobId) ?? MEMORY_CACHE.get(`${userId}:${jobId}`)
        if (!existing) return true

        scoresRef.current.set(jobId, existing)
        return false
      })

      if (missingJobIds.length === 0) {
        return
      }

      setIsLoading(true)

      try {
        const response = await fetch("/api/match/score/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: missingJobIds }),
        })

        if (!response.ok) {
          // 401: session not ready yet; 503: scoring unavailable - expected, don't spam the console
          if (response.status === 401 || response.status === 503) {
            return
          }
          const payload = (await response.json().catch(() => null)) as {
            error?: string
          } | null

          devWarn(
            "Failed to fetch match scores",
            payload?.error ?? response.statusText
          )
          return
        }

        const payload = (await response.json()) as {
          scores?: Record<string, JobMatchScore>
        }

        for (const [jobId, score] of Object.entries(payload.scores ?? {})) {
          scoresRef.current.set(jobId, score)
          MEMORY_CACHE.set(`${userId}:${jobId}`, score)
        }

        persist()
        forceRender((current) => current + 1)
      } catch (error) {
        devWarn("Failed to fetch match scores", error)
      } finally {
        setIsLoading(false)
      }
    },
    [persist, userId]
  )

  useEffect(() => {
    void loadScores(uniqueJobIds)
  }, [loadScores, uniqueJobIds])

  const getScore = useCallback((jobId: string) => scoresRef.current.get(jobId) ?? null, [])

  const requestDeepScore = useCallback(async (jobId: string) => {
    await fetch("/api/match/score/deep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    })
  }, [])

  return {
    scores: scoresRef.current,
    isLoading,
    getScore,
    requestDeepScore,
  }
}
