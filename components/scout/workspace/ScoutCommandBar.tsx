"use client"

import { Loader2, Mic, Send } from "lucide-react"
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
}: Props) {
  return (
    <div>
      {/* Main input */}
      <form onSubmit={onSubmit}>
        <div
          className={cn(
            "flex items-center gap-3 rounded-2xl border-2 bg-white px-4 py-3 transition-all duration-150",
            isLoading
              ? "border-[#FF5C18]/30 shadow-[0_0_0_4px_rgba(255,92,24,0.06)]"
              : "border-gray-200 focus-within:border-slate-950 focus-within:shadow-[0_0_0_4px_rgba(2,8,23,0.04)]"
          )}
        >
          {/* Mic — placeholder, not functional yet */}
          <button
            type="button"
            aria-label="Voice input (coming soon)"
            className="flex-shrink-0 text-gray-300 transition hover:text-gray-500"
            tabIndex={-1}
          >
            <Mic className="h-5 w-5" />
          </button>

          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onChange(e.target.value)}
            disabled={isLoading}
            placeholder={placeholder ?? "Ask Scout anything…"}
            autoComplete="off"
            className="w-full bg-transparent text-[15px] text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-50"
          />

          <button
            type="submit"
            disabled={!query.trim() || isLoading}
            aria-label="Submit"
            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#FF5C18] text-white shadow-[0_4px_12px_rgba(255,92,24,0.3)] transition hover:bg-[#E14F0E] hover:shadow-[0_4px_16px_rgba(255,92,24,0.4)] disabled:opacity-40 disabled:shadow-none"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>

      {/* Suggestion chips */}
      {chips.length > 0 && !isLoading && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onChipClick(chip)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
