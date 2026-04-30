"use client"

import { Loader2, Mic, Send } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

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
  // -1 = current draft; 0..N-1 = history index
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [draftQuery, setDraftQuery] = useState("")

  function handleChange(value: string) {
    // If user types while browsing history, reset index
    if (historyIndex !== -1) setHistoryIndex(-1)
    onChange(value)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!commandHistory.length) return

    if (e.key === "ArrowUp") {
      e.preventDefault()
      if (historyIndex === -1) {
        // Save current draft before navigating up
        setDraftQuery(query)
      }
      const nextIndex = Math.min(historyIndex + 1, commandHistory.length - 1)
      setHistoryIndex(nextIndex)
      onChange(commandHistory[nextIndex] ?? "")
    }

    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (historyIndex <= 0) {
        // Back to draft
        setHistoryIndex(-1)
        onChange(draftQuery)
      } else {
        const nextIndex = historyIndex - 1
        setHistoryIndex(nextIndex)
        onChange(commandHistory[nextIndex] ?? "")
      }
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

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div
          className={cn(
            "flex items-center gap-3 rounded-2xl px-4 py-3 transition-all duration-150",
            isDark
              ? "bg-white/95 ring-1 ring-white/10 focus-within:ring-2 focus-within:ring-[#FF5C18]/50"
              : "border-2 border-gray-200 bg-white focus-within:border-slate-950 focus-within:shadow-[0_0_0_4px_rgba(2,8,23,0.04)]",
            isLoading && !isDark && "border-[#FF5C18]/30"
          )}
        >
          <button
            type="button"
            aria-label="Voice input (coming soon)"
            tabIndex={-1}
            className={cn(
              "flex-shrink-0 transition",
              isDark ? "text-slate-400 hover:text-slate-200" : "text-gray-300 hover:text-gray-500"
            )}
          >
            <Mic className="h-5 w-5" />
          </button>

          <input
            ref={inputRef}
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder={placeholder ?? "Ask Scout anything…"}
            autoComplete="off"
            className="w-full bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-50"
          />

          {/* History indicator */}
          {historyIndex !== -1 && (
            <span className="flex-shrink-0 text-[10px] font-semibold text-gray-400">
              {historyIndex + 1}/{commandHistory.length}
            </span>
          )}

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

      {chips.length > 0 && !isLoading && (
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
