"use client"

import { ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

type Suggestion = {
  label: string
  query: string
  hint?: string
}

type Props = {
  suggestions: Suggestion[]
  onSelect: (query: string) => void
  className?: string
}

export function ScoutSuggestedCommands({ suggestions, onSelect, className }: Props) {
  if (suggestions.length === 0) return null
  return (
    <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", className)}>
      {suggestions.map((s, i) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onSelect(s.query)}
          style={{ animationDelay: `${i * 60}ms` }}
          className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white/80 px-3.5 py-2.5 text-left shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-[#FF5C18]/35 hover:bg-white hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5C18]/30 motion-safe:animate-[scoutFadeUp_0.5s_ease-out_both]"
        >
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-tight text-slate-800 group-hover:text-slate-950">
              {s.label}
            </p>
            {s.hint && (
              <p className="mt-0.5 truncate text-[11px] text-slate-400">{s.hint}</p>
            )}
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-[#FF5C18]" />
        </button>
      ))}
    </div>
  )
}
