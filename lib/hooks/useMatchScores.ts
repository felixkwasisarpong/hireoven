"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { devWarn } from "@/lib/client-dev-log"
import { FAST_SCORE_CACHE_EPOCH_MS } from "@/lib/matching/score-freshness"
import { fetchSessionUser } from "@/lib/supabase/client"
import type { JobMatchScore } from "@/types"

type CacheEnvelope = {
  expiresAt: number
  epochMs?: number
  scores: Record<string, JobMatchScore>
}

const MEMORY_CACHE = new Map<string, JobMatchScore>()
const ONE_HOUR_MS = 60 * 60 * 1_000

function getSessionKey(userId: string) {
  return `match_scores_${userId}_${FAST_SCORE_CACHE_EPOCH_MS}`
}

function getMemoryKey(userId: string, jobId: string) {
  return `${FAST_SCORE_CACHE_EPOCH_MS}:${userId}:${jobId}`
}

function isClientFreshScore(score: JobMatchScore | null | undefined) {
  if (!score?.computed_at) return false
  const computedAt = Date.parse(score.computed_at)
  return Number.isFinite(computedAt) && computedAt >= FAST_SCORE_CACHE_EPOCH_MS
}

function readSessionCache(userId: string) {
  if (typeof window === "undefined") return {}

  try {
    const raw = window.sessionStorage.getItem(getSessionKey(userId))
    if (!raw) return {}

    const parsed = JSON.parse(raw) as CacheEnvelope
    if (
      !parsed.expiresAt ||
      parsed.expiresAt < Date.now() ||
      parsed.epochMs !== FAST_SCORE_CACHE_EPOCH_MS
    ) {
      window.sessionStorage.removeItem(getSessionKey(userId))
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed.scores ?? {}).filter(([, score]) => isClientFreshScore(score))
    )
  } catch {
    return {}
  }
}

function writeSessionCache(userId: string, scores: Record<string, JobMatchScore>) {
  if (typeof window === "undefined") return

  const envelope: CacheEnvelope = {
    expiresAt: Date.now() + ONE_HOUR_MS,
    epochMs: FAST_SCORE_CACHE_EPOCH_MS,
    scores: Object.fromEntries(
      Object.entries(scores).filter(([, score]) => isClientFreshScore(score))
    ),
  }

  window.sessionStorage.setItem(getSessionKey(userId), JSON.stringify(envelope))
}

export function useMatchScores(jobIds: string[], externalUserId?: string | null) {
  const scoresRef = useRef<Map<string, JobMatchScore>>(new Map())
  const [userId, setUserId] = useState<string | null>(externalUserId ?? null)
  const [isLoading, setIsLoading] = useState(false)
  const [, forceRender] = useState(0)

  // Parent often passes `jobs.map((j) => j.id)` - new array reference every render. Key on content, not reference.
  const jobIdsFingerprint = jobIds.join("\0")
  const uniqueJobIds = useMemo(
    () => Array.from(new Set(jobIds.filter(Boolean))),
    [jobIdsFingerprint]
  )

  // Only fall back to fetching the session if the caller didn't provide a userId
  useEffect(() => {
    if (externalUserId !== undefined) {
      setUserId(externalUserId ?? null)
      return
    }
    let cancelled = false
    fetchSessionUser()
      .then((u) => { if (!cancelled) setUserId(u?.id ?? null) })
      .catch((error) => { devWarn("Failed to load match score user", error); if (!cancelled) setUserId(null) })
    return () => { cancelled = true }
  }, [externalUserId])

  useEffect(() => {
    if (!userId) return

    const cached = readSessionCache(userId)
    for (const [jobId, score] of Object.entries(cached)) {
      MEMORY_CACHE.set(getMemoryKey(userId, jobId), score)
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
        const existing = scoresRef.current.get(jobId) ?? MEMORY_CACHE.get(getMemoryKey(userId, jobId))
        if (!existing) return true
        if (!isClientFreshScore(existing)) return true

        scoresRef.current.set(jobId, existing)
        return false
      })

      setIsLoading(missingJobIds.length > 0)

      try {
        const response = await fetch("/api/match/score/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobIds: requestedJobIds }),
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

        const returnedJobIds = new Set(Object.keys(payload.scores ?? {}))

        for (const [jobId, score] of Object.entries(payload.scores ?? {})) {
          scoresRef.current.set(jobId, score)
          MEMORY_CACHE.set(getMemoryKey(userId, jobId), score)
        }

        for (const jobId of requestedJobIds) {
          if (returnedJobIds.has(jobId)) continue
          scoresRef.current.delete(jobId)
          MEMORY_CACHE.delete(getMemoryKey(userId, jobId))
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
