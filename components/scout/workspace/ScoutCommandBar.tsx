"use client"

import { Command, Loader2, Send } from "lucide-react"
import { AnimatedMic } from "@/components/scout/AnimatedMic"
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

// ── Minimal Web Speech API types (not in standard TS lib) ─────────────────────

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
interface SpeechRecognitionResultEvent {
  readonly resultIndex: number
  readonly results: { readonly length: number; [i: number]: { readonly isFinal: boolean; [j: number]: { readonly transcript: string } } }
}
interface SpeechRecognitionErrorEvent { readonly error: string }

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
  }
}

// ── Voice state ───────────────────────────────────────────────────────────────

type VoiceState = "idle" | "listening" | "processing" | "unsupported" | "error"

const VOICE_STATUS: Partial<Record<VoiceState, string>> = {
  listening:   "Listening…",
  processing:  "Processing…",
  unsupported: "Voice not supported in this browser",
  error:       "Couldn't hear that. Try again.",
}

// ── useVoiceRecognition ───────────────────────────────────────────────────────

function useVoiceRecognition(onTranscript: (text: string, isFinal: boolean) => void) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle")
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
  const isListeningRef = useRef(false)
  const voiceStateRef = useRef<VoiceState>("idle")

  // Keep ref in sync so callbacks can read the latest state
  useEffect(() => { voiceStateRef.current = voiceState }, [voiceState])

  // Detect support once, client-side only
  const supported = typeof window !== "undefined"
    && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

  function stop() {
    recognitionRef.current?.stop()
  }

  function start() {
    const API = window.SpeechRecognition ?? window.webkitSpeechRecognition
    const recognition = new API()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = "en-US"

    recognition.onstart = () => {
      isListeningRef.current = true
      setVoiceState("listening")
    }

    recognition.onresult = (event) => {
      const result = event.results[event.resultIndex]
      const transcript = result[0].transcript.trim()
      const isFinal = result.isFinal
      onTranscript(transcript, isFinal)
      if (isFinal) setVoiceState("processing")
    }

    recognition.onerror = (event) => {
      isListeningRef.current = false
      recognitionRef.current = null
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setVoiceState("unsupported")
      } else if (event.error === "no-speech" || event.error === "aborted") {
        setVoiceState(voiceStateRef.current === "listening" ? "error" : "idle")
      } else {
        setVoiceState("error")
      }
    }

    recognition.onend = () => {
      isListeningRef.current = false
      recognitionRef.current = null
      // Reset to idle after listen/finalize; keep explicit unsupported/error states.
      setVoiceState((prev) =>
        prev === "listening" || prev === "processing" ? "idle" : prev
      )
    }

    recognitionRef.current = recognition
    recognition.start()
  }

  function toggle() {
    if (!supported) { setVoiceState("unsupported"); return }
    if (isListeningRef.current) { stop(); return }
    setVoiceState("idle") // clear previous error before starting
    start()
  }

  // Clean up on unmount
  useEffect(() => () => { recognitionRef.current?.abort() }, [])

  return { voiceState, toggle, supported }
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  query: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  isLoading: boolean
  chips: string[]
  onChipClick: (chip: string) => void
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement>
  /** "dark" renders chips for a slate-950 container */
  variant?: "light" | "dark"
  /** Command history for up/down navigation */
  commandHistory?: string[]
  /** Open the command palette */
  onOpenPalette?: () => void
}

export function ScoutCommandBar({
  query,
  onChange,
  onSubmit,
  isLoading,
  chips,
  onChipClick,
  placeholder,
  inputRef,
  variant = "light",
  commandHistory = [],
  onOpenPalette,
}: Props) {
  const isDark = variant === "dark"
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftQuery,   setDraftQuery]   = useState("")

  const { voiceState, toggle: toggleVoice, supported: voiceSupported } =
    useVoiceRecognition((text, isFinal) => {
      onChange(text)
      if (isFinal) return
    })

  const isListening = voiceState === "listening"
  const isProcessing = voiceState === "processing"
  const statusText  = VOICE_STATUS[voiceState]

  // ── History navigation ──────────────────────────────────────────────────────

  function handleChange(value: string) {
    // "/" as the first character in an empty bar opens the command palette
    if (value === "/" && query === "" && onOpenPalette) {
      onOpenPalette()
      return
    }
    if (historyIndex !== -1) setHistoryIndex(-1)
    onChange(value)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!commandHistory.length) return

    if (e.key === "ArrowUp") {
      e.preventDefault()
      if (historyIndex === -1) setDraftQuery(query)
      const next = Math.min(historyIndex + 1, commandHistory.length - 1)
      setHistoryIndex(next)
      onChange(commandHistory[next] ?? "")
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (historyIndex <= 0) { setHistoryIndex(-1); onChange(draftQuery) }
      else { const next = historyIndex - 1; setHistoryIndex(next); onChange(commandHistory[next] ?? "") }
    }

    if (e.key === "Escape" && historyIndex !== -1) {
      e.preventDefault()
      setHistoryIndex(-1)
      onChange(draftQuery)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    setHistoryIndex(-1)
    setDraftQuery("")
    onSubmit(e)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl px-4 py-2.5 transition-all duration-150",
            isDark
              ? cn(
                  "bg-white/95 ring-1",
                  isListening
                    ? "ring-[#FF5C18]/60 shadow-[0_0_0_3px_rgba(255,92,24,0.15)]"
                    : "ring-white/10 focus-within:ring-2 focus-within:ring-[#FF5C18]/50"
                )
              : cn(
                  "border bg-white",
                  isListening
                    ? "border-[#FF5C18] shadow-[0_0_0_2px_rgba(255,92,24,0.16)]"
                    : isProcessing
                      ? "border-slate-300 shadow-[0_0_0_2px_rgba(148,163,184,0.14)]"
                    : "border-[#FFD5C2] focus-within:border-[#FF5C18] focus-within:shadow-[0_0_0_2px_rgba(255,92,24,0.14)]"
                )
            )}
        >
          {/* Mic button */}
          <div className="relative flex-shrink-0">
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-0 rounded-full",
                !voiceSupported
                  ? "bg-transparent"
                  : isListening
                    ? "animate-ping bg-[#FF5C18]/25"
                    : isProcessing
                      ? "animate-pulse bg-slate-300/35"
                    : "animate-pulse bg-[#FF5C18]/10"
              )}
            />
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={
                !voiceSupported ? "Voice not supported" :
                isListening ? "Stop listening" : "Start voice input"
              }
              disabled={isLoading}
              className={cn(
                "relative inline-flex h-9 w-9 items-center justify-center rounded-full border transition",
                !voiceSupported
                  ? "cursor-not-allowed border-slate-200 bg-slate-100 text-gray-400 opacity-50"
                  : isListening
                    ? "border-[#FF5C18] bg-[#FFF2EB] text-[#FF5C18] shadow-[0_0_0_3px_rgba(255,92,24,0.15)]"
                    : isProcessing
                      ? "border-slate-300 bg-slate-100 text-slate-500"
                    : voiceState === "error"
                      ? "border-amber-300 bg-amber-50 text-amber-600 hover:border-amber-400"
                      : isDark
                        ? "border-white/20 bg-white/10 text-slate-200 hover:border-white/40"
                        : "border-[#FFD9C7] bg-white text-[#FF5C18] hover:border-[#FF5C18]/50 hover:bg-[#FFF8F5]"
              )}
            >
              {isProcessing ? (
                <Loader2 className="h-[18px] w-[18px] animate-spin" />
              ) : (
                <AnimatedMic state={voiceState} iconSize={18} />
              )}
            </button>
          </div>

          {/* Input */}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder={
              isListening
                ? "Listening…"
                : placeholder ?? "Ask Scout anything…"
            }
            autoComplete="off"
            className={cn(
              "w-full bg-transparent text-[15px] text-gray-900 outline-none disabled:opacity-50",
              isListening ? "placeholder:text-[#FF5C18]/60" : "placeholder:text-gray-400"
            )}
          />

          {/* History index counter */}
          {historyIndex !== -1 && (
            <span className="flex-shrink-0 text-[10px] font-semibold text-gray-400">
              {historyIndex + 1}/{commandHistory.length}
            </span>
          )}

          {/* Command palette trigger */}
          {onOpenPalette && (
            <button
              type="button"
              onClick={onOpenPalette}
              aria-label="Open command palette (⌘K)"
              className={cn(
                "inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 transition",
                isDark
                  ? "text-slate-500 hover:bg-white/8 hover:text-slate-300"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              )}
            >
              <Command className="h-3.5 w-3.5" />
              <span className="hidden text-[10px] font-medium sm:inline">K</span>
            </button>
          )}

          {/* Send */}
          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            aria-label="Submit"
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#FF5C18] text-white shadow-[0_2px_8px_rgba(255,92,24,0.3)] transition hover:bg-[#E14F0E] disabled:opacity-40 disabled:shadow-none"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>

      {/* Voice status line */}
      {statusText && (
        <p
          className={cn(
            "mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium",
            voiceState === "listening"  ? "text-[#FF5C18]" :
            voiceState === "processing" ? "text-gray-400" :
            voiceState === "error"      ? "text-amber-600" :
                                          "text-gray-400"
          )}
        >
          {voiceState === "listening" && (
            <span className="mr-0.5 inline-flex items-center gap-[2px]">
              <span className="inline-block h-1.5 w-1 rounded-full bg-[#FF5C18] animate-pulse" />
              <span className="inline-block h-2 w-1 rounded-full bg-[#FF5C18]/80 animate-pulse [animation-delay:120ms]" />
              <span className="inline-block h-1.5 w-1 rounded-full bg-[#FF5C18] animate-pulse [animation-delay:220ms]" />
            </span>
          )}
          {statusText}
        </p>
      )}

      {/* Suggestion chips */}
      {chips.length > 0 && !isLoading && !isListening && (
        <div className="mt-3">
          <p
            className={cn(
              "mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
              isDark ? "text-white/50" : "text-slate-400"
            )}
          >
            Quick prompts
          </p>
          <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1">
            {chips.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => { setHistoryIndex(-1); onChipClick(chip) }}
                className={cn(
                  "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition",
                  isDark
                    ? "border-white/12 text-white/60 hover:border-white/30 hover:bg-white/8 hover:text-white"
                    : "border-slate-200 bg-transparent text-slate-600 hover:border-[#FF5C18]/40 hover:bg-[#FFF8F5] hover:text-[#FF5C18]"
                )}
              >
                {chip}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
