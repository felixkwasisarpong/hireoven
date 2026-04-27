"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ResumeAnalysis } from "@/types"

type State = {
  analysis: ResumeAnalysis | null
  isLoading: boolean
  isAnalyzing: boolean
  error: string | null
}

// Module-level cache so analyses persist across component mounts within a session
const sessionCache = new Map<string, ResumeAnalysis>()

function cacheKey(resumeId: string, jobId: string) {
  return `${resumeId}:${jobId}`
}

export function useResumeAnalysis(resumeId: string | null, jobId: string | null) {
  const [state, setState] = useState<State>(() => {
    const key = resumeId && jobId ? cacheKey(resumeId, jobId) : null
    const cached = key ? sessionCache.get(key) ?? null : null
    return {
      analysis: cached,
      isLoading: !cached && Boolean(resumeId && jobId),
      isAnalyzing: false,
      error: null,
    }
  })

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMounted = useRef(true)

  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      if (pollingRef.current) clearInterval(pollingRef.current)
    }
  }, [])

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const fetchExisting = useCallback(async () => {
    if (!resumeId || !jobId) return null
    const key = cacheKey(resumeId, jobId)

    const cached = sessionCache.get(key)
    if (cached) return cached

    const res = await fetch(`/api/resume/analyze?resumeId=${resumeId}&jobId=${jobId}`, {
      cache: "no-store",
      credentials: "include",
    })
    if (!res.ok) return null
    const data = (await res.json()) as ResumeAnalysis | null
    if (data) sessionCache.set(key, data)
    return data
  }, [resumeId, jobId])

  const triggerAnalysis = useCallback(async () => {
    if (!resumeId || !jobId) return
    if (!isMounted.current) return

    setState((s) => ({ ...s, isAnalyzing: true, error: null }))

    try {
      const res = await fetch("/api/resume/analyze", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId, jobId }),
      })
      const data = await res.json() as ResumeAnalysis & { error?: string }

      if (!res.ok) throw new Error(data.error ?? "Analysis failed")

      const key = cacheKey(resumeId, jobId)
      sessionCache.set(key, data)
      if (isMounted.current) {
        setState({ analysis: data, isLoading: false, isAnalyzing: false, error: null })
      }
    } catch (err) {
      if (isMounted.current) {
        setState((s) => ({
          ...s,
          isAnalyzing: false,
          isLoading: false,
          error: err instanceof Error ? err.message : "Analysis failed",
        }))
      }
    }
  }, [resumeId, jobId])

  const refetch = useCallback(async () => {
    if (!resumeId || !jobId) return
    const key = cacheKey(resumeId, jobId)
    sessionCache.delete(key)
    setState((s) => ({ ...s, isLoading: true, error: null }))
    const data = await fetchExisting()
    if (isMounted.current) {
      setState({ analysis: data, isLoading: false, isAnalyzing: false, error: null })
    }
  }, [resumeId, jobId, fetchExisting])

  // On mount: load existing analysis from API
  useEffect(() => {
    if (!resumeId || !jobId) {
      setState({ analysis: null, isLoading: false, isAnalyzing: false, error: null })
      return
    }

    const key = cacheKey(resumeId, jobId)
    if (sessionCache.has(key)) {
      setState({
        analysis: sessionCache.get(key)!,
        isLoading: false,
        isAnalyzing: false,
        error: null,
      })
      return
    }

    let cancelled = false
    fetchExisting().then((data) => {
      if (cancelled || !isMounted.current) return
      setState({ analysis: data, isLoading: false, isAnalyzing: false, error: null })
    })

    return () => { cancelled = true }
  }, [resumeId, jobId, fetchExisting])

  return {
    analysis: state.analysis,
    isLoading: state.isLoading,
    isAnalyzing: state.isAnalyzing,
    error: state.error,
    triggerAnalysis,
    refetch,
  }
}
