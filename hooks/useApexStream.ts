"use client"

import { useCallback, useRef, useState } from "react"
import { normalizeApexResponse } from "@/lib/apex/normalize"
import { parseSSELine, type ApexStreamEvent } from "@/lib/apex/streaming/types"
import type { ApexResponse } from "@/lib/apex/types"
import type { ApexWorkspaceDirective, ApexWorkflowDirective } from "@/lib/apex/types"

/**
 * Client-side hard deadline. Server's apex_chat_stream timeout is 25s; this
 * is the safety net for cases where the server emits `done` (or the
 * connection drops) without a preceding `response` event — proxy timeouts,
 * mid-stream crashes, etc. Without this, isStreaming flips false but
 * finalResponse stays null, and the UI hangs on the thinking canvas.
 */
const STREAM_HARD_TIMEOUT_MS = 45_000
const STREAM_ABSOLUTE_TIMEOUT_MS = 75_000

export type ApexStreamState = {
  /** Accumulated raw text from text_delta events */
  streamText:          string
  /** True while Claude is generating */
  isStreaming:         boolean
  /** The full processed response — only set after done */
  finalResponse:       ApexResponse | null
  /** Workspace directive emitted mid-stream (if any) — for early workspace morph */
  earlyDirective:      ApexWorkspaceDirective | null
  earlyWorkflow:       ApexWorkflowDirective | null
  error:               string | null
}

export type ApexStreamActions = ApexStreamState & {
  startStream: (url: string, body: Record<string, unknown>) => Promise<void>
  cancel:      () => void
  reset:       () => void
}

const INITIAL: ApexStreamState = {
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

  // Apex model responses are JSON-first in command mode; never render raw JSON
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

export function useApexStream(): ApexStreamActions {
  const [state, setState] = useState<ApexStreamState>(INITIAL)
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

    // Two client-side safeguards:
    // 1) Activity timeout (resets on stream activity).
    // 2) Absolute timeout (never resets; prevents infinite keepalive hangs).
    let receivedFinalResponse = false
    let sawDoneEvent = false
    let hardTimeout = 0
    let absoluteTimeout = 0
    const resetHardTimeout = () => {
      if (hardTimeout) window.clearTimeout(hardTimeout)
      hardTimeout = window.setTimeout(() => {
        if (!receivedFinalResponse) {
          try { abortRef.current?.abort() } catch {}
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error: prev.error ?? "Apex took too long to respond. Please try again.",
          }))
        }
      }, STREAM_HARD_TIMEOUT_MS)
    }
    absoluteTimeout = window.setTimeout(() => {
      if (!receivedFinalResponse) {
        try { abortRef.current?.abort() } catch {}
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: prev.error ?? "Apex is taking longer than expected. Please try again.",
        }))
      }
    }, STREAM_ABSOLUTE_TIMEOUT_MS)
    resetHardTimeout()

    setState({
      ...INITIAL,
      isStreaming: true,
    })

    try {
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body:    JSON.stringify({ source: "workspace", ...body, stream: true }),
        signal:  abortRef.current.signal,
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => null) as { message?: string } | null
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: errJson?.message ?? "Apex could not respond right now.",
        }))
        return
      }

      const contentType = res.headers.get("content-type")?.toLowerCase() ?? ""
      // Some Apex paths intentionally return JSON even when stream=true
      // (deterministic / early-return responses). Treat those as a completed
      // response instead of trying to parse SSE frames.
      if (contentType.includes("application/json")) {
        receivedFinalResponse = true
        window.clearTimeout(hardTimeout)
        window.clearTimeout(absoluteTimeout)
        const payload = await res.json().catch(() => null)
        setState((prev) => ({
          ...prev,
          finalResponse: normalizeApexResponse(payload),
          isStreaming: false,
          error: null,
        }))
        return
      }

      if (!res.body) {
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: "Apex could not open a response stream. Please try again.",
        }))
        return
      }

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer    = ""
      let rawStreamText = ""

      const processEvent = (event: ApexStreamEvent) => {
        resetHardTimeout()
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
            receivedFinalResponse = true
            window.clearTimeout(hardTimeout)
            window.clearTimeout(absoluteTimeout)
            setState((prev) => ({
              ...prev,
              finalResponse: normalizeApexResponse(event.payload),
              isStreaming:   false,
            }))
            break

          case "done":
            sawDoneEvent = true
            window.clearTimeout(hardTimeout)
            window.clearTimeout(absoluteTimeout)
            setState((prev) => ({ ...prev, isStreaming: false }))
            break

          case "error":
            receivedFinalResponse = true // suppress hard-timeout error override
            window.clearTimeout(hardTimeout)
            window.clearTimeout(absoluteTimeout)
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
        resetHardTimeout()
        buffer += decoder.decode(readResult.value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          const event = parseSSELine(line.trim())
          if (event) processEvent(event)
        }
      }

      // Stream ended (reader.done or aborted). If we never received a
      // `response` event AND nothing already set an error, surface a
      // recovery message so the workspace doesn't hang on the thinking
      // canvas forever.
      if (!receivedFinalResponse) {
        setState((prev) => {
          if (prev.finalResponse || prev.error) return { ...prev, isStreaming: false }

          const raw = rawStreamText.trim()
          // Best-effort recovery: when stream dropped after text was emitted,
          // promote the partial/final text into a minimal safe ApexResponse.
          if (raw.length > 0) {
            const recovered = normalizeApexResponse({
              answer: deriveDisplayStreamText(raw).trim() || "Apex response recovered from a partial stream.",
              recommendation: "Explore",
              actions: [],
            })
            return {
              ...prev,
              isStreaming: false,
              finalResponse: recovered,
              error: sawDoneEvent ? null : "Apex connection ended early. Showing partial response.",
            }
          }

          return {
            ...prev,
            isStreaming: false,
            error: "Apex's response was cut off. Please try again.",
          }
        })
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
    } finally {
      window.clearTimeout(hardTimeout)
      window.clearTimeout(absoluteTimeout)
    }
  }, [])

  return { ...state, startStream, cancel, reset }
}
