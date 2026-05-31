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

export function ApexSuggestedCommands({ suggestions, onSelect, className }: Props) {
  if (suggestions.length === 0) return null
  return (
    <div className={cn("grid grid-cols-1 gap-2.5 sm:grid-cols-2", className)}>
      {suggestions.map((s, i) => (
        <button
          key={s.label}
          type="button"
          onClick={() => onSelect(s.query)}
          style={{ animationDelay: `${i * 55}ms` }}
          className={cn(
            "group relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 px-4 py-3.5 text-left",
            "shadow-[0_2px_6px_rgba(15,23,42,0.06),0_1px_2px_rgba(15,23,42,0.05)]",
            "transition-all duration-200",
            "hover:-translate-y-0.5 hover:border-[#2563EB]/35",
            "hover:shadow-[0_10px_28px_rgba(37,99,235,0.14),0_3px_10px_rgba(15,23,42,0.08)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/35",
            "motion-safe:animate-[apexFadeUp_0.5s_ease-out_both]",
          )}
        >
          {/* Hover glow fill */}
          <span
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            style={{
              background: "linear-gradient(135deg, rgba(37,99,235,0.045) 0%, rgba(14,165,233,0.02) 100%)",
            }}
          />
          {/* Left accent bar on hover */}
          <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-2xl bg-[#2563EB] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

          <div className="relative min-w-0">
            <p className="text-[13.5px] font-semibold leading-snug text-slate-800 transition-colors duration-150 group-hover:text-slate-950">
              {s.label}
            </p>
            {s.hint && (
              <p className="mt-0.5 truncate text-[11.5px] leading-relaxed text-slate-500 transition-colors duration-150 group-hover:text-slate-600">
                {s.hint}
              </p>
            )}
          </div>

          <ArrowRight className="relative h-3.5 w-3.5 shrink-0 text-slate-300 transition-all duration-150 group-hover:translate-x-0.5 group-hover:text-[#2563EB]" />
        </button>
      ))}
    </div>
  )
}
