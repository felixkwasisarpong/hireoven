"use client"

import { useCallback, useRef, useState } from "react"
import { normalizeScoutResponse } from "@/lib/scout/normalize"
import { parseSSELine, type ScoutStreamEvent } from "@/lib/scout/streaming/types"
import type { ScoutResponse } from "@/lib/scout/types"
import type { ScoutWorkspaceDirective, ScoutWorkflowDirective } from "@/lib/scout/types"

export type ScoutStreamState = {
  /** Accumulated raw text from text_delta events */
  streamText:          string
  /** True while Claude is generating */
  isStreaming:         boolean
  /** The full processed response — only set after done */
  finalResponse:       ScoutResponse | null
  /** Workspace directive emitted mid-stream (if any) — for early workspace morph */
  earlyDirective:      ScoutWorkspaceDirective | null
  earlyWorkflow:       ScoutWorkflowDirective | null
  error:               string | null
}

export type ScoutStreamActions = ScoutStreamState & {
  startStream: (url: string, body: Record<string, unknown>) => Promise<void>
  cancel:      () => void
  reset:       () => void
}

const INITIAL: ScoutStreamState = {
  streamText:     "",
  isStreaming:    false,
  finalResponse:  null,
  earlyDirective: null,
  earlyWorkflow:  null,
  error:          null,
}

function deriveDisplayStreamText(raw: string): string {
  const trimmed = raw.trimStart()
  if (!trimmed) return ""

  // Scout model responses are JSON-first in command mode; never render raw JSON
  // tokens in the live bubble.
  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("```") ||
    /^"answer"\s*:/.test(trimmed) ||
    (trimmed.includes('"recommendation"') && trimmed.includes('"actions"'))
  ) {
    return ""
  }

  return raw
}

export function useScoutStream(): ScoutStreamActions {
  const [state, setState] = useState<ScoutStreamState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setState((prev) => ({ ...prev, isStreaming: false }))
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState(INITIAL)
  }, [])

  const startStream = useCallback(async (url: string, body: Record<string, unknown>) => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setState({
      ...INITIAL,
      isStreaming: true,
    })

    try {
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body:    JSON.stringify({ ...body, stream: true }),
        signal:  abortRef.current.signal,
      })

      if (!res.ok || !res.body) {
        const errJson = await res.json().catch(() => null) as { message?: string } | null
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: errJson?.message ?? "Scout could not respond right now.",
        }))
        return
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ""
      let rawStreamText = ""

      const processEvent = (event: ScoutStreamEvent) => {
        switch (event.type) {
          case "text_delta":
            rawStreamText += event.text
            setState((prev) => ({ ...prev, streamText: deriveDisplayStreamText(rawStreamText) }))
            break

          case "workspace_directive":
            setState((prev) => ({ ...prev, earlyDirective: event.payload }))
            break

          case "workflow_directive":
            setState((prev) => ({ ...prev, earlyWorkflow: event.payload }))
            break

          case "response":
            setState((prev) => ({
              ...prev,
              finalResponse: normalizeScoutResponse(event.payload),
              isStreaming:   false,
            }))
            break

          case "done":
            setState((prev) => ({ ...prev, isStreaming: false }))
            break

          case "error":
            setState((prev) => ({
              ...prev,
              isStreaming: false,
              error: event.message,
            }))
            break
        }
      }

      // Read SSE stream
      while (true) {
        let readResult: ReadableStreamReadResult<Uint8Array>
        try {
          readResult = await reader.read()
        } catch {
          // AbortError or network error
          setState((prev) => ({ ...prev, isStreaming: false }))
          break
        }

        if (readResult.done) break
        buffer += decoder.decode(readResult.value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const event = parseSSELine(line.trim())
          if (event) processEvent(event)
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState((prev) => ({ ...prev, isStreaming: false }))
      } else {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: "Network error. Please check your connection.",
        }))
      }
    }
  }, [])

  return { ...state, startStream, cancel, reset }
}
