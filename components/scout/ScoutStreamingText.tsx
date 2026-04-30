"use client"

import { useEffect, useRef, useState } from "react"

/**
 * Renders streaming text with phrase-chunked updates.
 *
 * Batches incoming characters into sentence/phrase boundaries before
 * triggering React re-renders — eliminates token-by-token jitter while
 * still feeling live.
 *
 * Flush triggers:
 *   - sentence punctuation followed by space: `. ` `! ` `? `
 *   - double newline (paragraph break)
 *   - comma or colon + space in long phrases (≥40 chars)
 *   - 120ms timeout since last flush (catchall)
 */

const SENTENCE_END_RE = /[.!?]\s/
const SOFT_BREAK_RE   = /[,:]\s/
const FLUSH_TIMEOUT_MS = 120

type Props = {
  /** Full text accumulated so far — parent appends to this as chunks arrive */
  text:      string
  className?: string
}

export function ScoutStreamingText({ text, className }: Props) {
  const [displayed, setDisplayed]   = useState("")
  const pendingRef  = useRef("")
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

  function flush() {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setDisplayed((prev) => prev + pendingRef.current)
    pendingRef.current = ""
  }

  useEffect(() => {
    // diff: only process newly added characters
    const incoming = text.slice(displayed.length + pendingRef.current.length)
    if (!incoming) return

    pendingRef.current += incoming

    // Flush at natural boundaries
    const hasSentenceEnd = SENTENCE_END_RE.test(pendingRef.current)
    const hasParagraph   = pendingRef.current.includes("\n\n")
    const hasSoftBreak   = pendingRef.current.length >= 40 && SOFT_BREAK_RE.test(pendingRef.current)

    if (hasSentenceEnd || hasParagraph || hasSoftBreak) {
      flush()
      return
    }

    // Fallback: flush on timeout even without a boundary
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, FLUSH_TIMEOUT_MS)
  }, [text, displayed])

  // Final flush when text stops arriving
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <p className={className ?? "whitespace-pre-wrap text-sm leading-7 text-slate-800"}>
      {displayed}
      {/* Blinking cursor while streaming */}
      {displayed.length < text.length && (
        <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-[#FF5C18]/70 align-middle" />
      )}
    </p>
  )
}
