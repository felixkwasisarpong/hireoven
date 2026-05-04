"use client"

import { useCallback, useRef, useState } from "react"
import { parseResearchSSELine } from "@/lib/scout/research/types"
import type { ScoutResearchTask, ResearchSSEEvent } from "@/lib/scout/research/types"

export type ResearchStreamState = {
  task:      ScoutResearchTask | null
  isRunning: boolean
  error:     string | null
}

export type ResearchStreamActions = ResearchStreamState & {
  startStream: (url: string, body: Record<string, unknown>) => Promise<void>
  cancel:      () => void
  reset:       () => void
}

const INITIAL: ResearchStreamState = { task: null, isRunning: false, error: null }

export function useResearchStream(): ResearchStreamActions {
  const [state, setState] = useState<ResearchStreamState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setState((prev) => ({ ...prev, isRunning: false }))
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState(INITIAL)
  }, [])

  const processEvent = useCallback((event: ResearchSSEEvent) => {
    switch (event.type) {

      case "research_init":
        setState((prev) => ({ ...prev, task: event.task, isRunning: true, error: null }))
        break

      case "research_step_start":
        setState((prev) => {
          if (!prev.task) return prev
          return {
            ...prev,
            task: {
              ...prev.task,
              steps: prev.task.steps.map((s) =>
                s.id === event.stepId ? { ...s, status: "running" as const } : s
              ),
            },
          }
        })
        break

      case "research_step_done":
        setState((prev) => {
          if (!prev.task) return prev
          return {
            ...prev,
            task: {
              ...prev.task,
              steps: prev.task.steps.map((s) =>
                s.id === event.stepId
                  ? { ...s, status: "completed" as const, summary: event.summary, durationMs: event.durationMs }
                  : s
              ),
            },
          }
        })
        break

      case "research_finding":
        setState((prev) => {
          if (!prev.task) return prev
          return {
            ...prev,
            task: { ...prev.task, findings: [...(prev.task.findings ?? []), event.finding] },
          }
        })
        break

      case "research_complete":
        setState((prev) => ({ ...prev, task: event.task, isRunning: false }))
        break

      case "research_error":
        setState((prev) => ({ ...prev, isRunning: false, error: event.message }))
        break
    }
  }, [])

  const startStream = useCallback(async (url: string, body: Record<string, unknown>) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setState(INITIAL)

    try {
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        const errJson = await res.json().catch(() => null) as { error?: string } | null
        setState({ task: null, isRunning: false, error: errJson?.error ?? "Research could not start." })
        return
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ""

      while (true) {
        let read: ReadableStreamReadResult<Uint8Array>
        try { read = await reader.read() } catch { break }
        if (read.done) break

        buffer += decoder.decode(read.value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const event = parseResearchSSELine(line.trim())
          if (event) processEvent(event)
        }
      }

      // Ensure isRunning is cleared if stream closes without research_complete
      setState((prev) => prev.isRunning ? { ...prev, isRunning: false } : prev)

    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState((prev) => ({ ...prev, isRunning: false }))
      } else {
        setState({ task: null, isRunning: false, error: "Network error. Please try again." })
      }
    }
  }, [processEvent])

  return { ...state, startStream, cancel, reset }
}
