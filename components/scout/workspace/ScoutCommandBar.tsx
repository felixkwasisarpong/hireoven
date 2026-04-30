"use client"

import { Loader2, Mic, MicOff, Send } from "lucide-react"
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
      // Only reset if we haven't already transitioned to processing/error
      setVoiceState((prev) => (prev === "listening" ? "idle" : prev))
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
}: Props) {
  const isDark = variant === "dark"
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftQuery,   setDraftQuery]   = useState("")

  const { voiceState, toggle: toggleVoice, supported: voiceSupported } =
    useVoiceRecognition((text, isFinal) => {
      onChange(text)
      // Brief "processing" state resolves to idle once transcript is set
      if (isFinal) setTimeout(() => setVoiceState_("idle"), 600)
    })

  // Expose a stable setter for the post-final idle transition above
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const setVoiceState_ = useState<VoiceState>("idle")[1]

  const isListening = voiceState === "listening"
  const statusText  = VOICE_STATUS[voiceState]

  // ── History navigation ──────────────────────────────────────────────────────

  function handleChange(value: string) {
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
            "flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-150",
            isDark
              ? cn(
                  "bg-white/95 ring-1",
                  isListening
                    ? "ring-[#FF5C18]/60 shadow-[0_0_0_3px_rgba(255,92,24,0.15)]"
                    : "ring-white/10 focus-within:ring-2 focus-within:ring-[#FF5C18]/50"
                )
              : cn(
                  "border-2 bg-white",
                  isListening
                    ? "border-[#FF5C18] shadow-[0_0_0_4px_rgba(255,92,24,0.12)]"
                    : "border-gray-200 focus-within:border-slate-950 focus-within:shadow-[0_0_0_4px_rgba(2,8,23,0.04)]"
                )
          )}
        >
          {/* Mic button */}
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={
              !voiceSupported ? "Voice not supported" :
              isListening ? "Stop listening" : "Start voice input"
            }
            disabled={isLoading}
            className={cn(
              "flex-shrink-0 transition",
              !voiceSupported
                ? "cursor-not-allowed opacity-30 text-gray-400"
                : isListening
                  ? "text-[#FF5C18] animate-pulse"
                  : voiceState === "error"
                    ? "text-amber-500 hover:text-amber-600"
                    : isDark
                      ? "text-slate-400 hover:text-slate-200"
                      : "text-gray-400 hover:text-gray-600"
            )}
          >
            {voiceState === "unsupported" || voiceState === "error"
              ? <MicOff className="h-5 w-5" />
              : <Mic className="h-5 w-5" />}
          </button>

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

          {/* Send */}
          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            aria-label="Submit"
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5C18] text-white shadow-[0_4px_12px_rgba(255,92,24,0.35)] transition hover:bg-[#E14F0E] hover:shadow-[0_4px_16px_rgba(255,92,24,0.45)] disabled:opacity-40 disabled:shadow-none"
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
            "mt-2 text-[11px] font-medium",
            voiceState === "listening"  ? "text-[#FF5C18]" :
            voiceState === "processing" ? "text-gray-400" :
            voiceState === "error"      ? "text-amber-600" :
                                          "text-gray-400"
          )}
        >
          {voiceState === "listening" && (
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#FF5C18] animate-pulse" />
          )}
          {statusText}
        </p>
      )}

      {/* Suggestion chips */}
      {chips.length > 0 && !isLoading && !isListening && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => { setHistoryIndex(-1); onChipClick(chip) }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                isDark
                  ? "border-white/12 text-white/50 hover:border-white/30 hover:bg-white/8 hover:text-white"
                  : "border-gray-200 bg-white text-gray-500 hover:border-slate-950 hover:bg-slate-950 hover:text-white"
              )}
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
