"use client"

import { useState } from "react"
import { ArrowRight, Sparkles } from "lucide-react"
import { markApexWelcomeSeen } from "@/lib/apex/first-run"
import { cn } from "@/lib/utils"

type Capability = {
  emoji: string
  label: string
  example: string
  query: string
}

const CAPABILITIES: Capability[] = [
  {
    emoji: "🔍",
    label: "Find jobs",
    example: "Find high-fit roles matching my profile",
    query: "Find jobs that match my profile and rank them by fit",
  },
  {
    emoji: "📝",
    label: "Resume",
    example: "Tailor my resume for a specific role",
    query: "Tailor my resume for the job I'm targeting",
  },
  {
    emoji: "🎯",
    label: "Interview prep",
    example: "Prep me for a specific company's interview",
    query: "Help me prepare for my upcoming interview",
  },
  {
    emoji: "⚖️",
    label: "Compare jobs",
    example: "Compare my saved jobs and pick the best one",
    query: "Compare my top saved jobs and pick the best one",
  },
  {
    emoji: "📋",
    label: "Applications",
    example: "Show my application pipeline and what's next",
    query: "Show my application pipeline and tell me what to do next",
  },
  {
    emoji: "💰",
    label: "Salary coaching",
    example: "How should I handle the comp conversation?",
    query: "How should I handle compensation and salary questions in the interview?",
  },
  {
    emoji: "⚡",
    label: "Autofill",
    example: "Prepare autofill for this application",
    query: "Prepare a tailored autofill strategy for the current job application",
  },
  {
    emoji: "🌐",
    label: "Visa & sponsorship",
    example: "Find companies with strong H-1B track records",
    query: "Find tech companies with strong H-1B sponsorship track records",
  },
]

type Props = {
  firstName?: string
  onSelect: (query: string) => void
  className?: string
}

export function ApexWelcomeMessage({ firstName, onSelect, className }: Props) {
  const [dismissed, setDismissed] = useState(false)

  function dismiss() {
    markApexWelcomeSeen()
    setDismissed(true)
  }

  function handleSelect(query: string) {
    markApexWelcomeSeen()
    onSelect(query)
  }

  if (dismissed) return null

  return (
    <div
      className={cn(
        "w-full rounded-2xl border border-[#2563EB]/20 bg-white shadow-[0_2px_16px_rgba(37,99,235,0.08)]",
        "motion-safe:animate-[apexFadeUp_0.45s_ease-out_both]",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#2563EB]/10">
          <Sparkles className="h-4 w-4 text-[#2563EB]" />
        </div>
        <div>
          <p className="text-[13.5px] font-semibold text-slate-900">
            {firstName ? `Hey ${firstName} — here's what I can do.` : "Here's what I can do."}
          </p>
          <p className="mt-0.5 text-[12px] text-slate-500">
            Tap any capability to get started right away.
          </p>
        </div>
      </div>

      {/* Capability grid */}
      <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-2">
        {CAPABILITIES.map((cap, i) => (
          <button
            key={cap.label}
            type="button"
            onClick={() => handleSelect(cap.query)}
            style={{ animationDelay: `${60 + i * 40}ms` }}
            className={cn(
              "group flex items-start gap-3 bg-white px-4 py-3.5 text-left",
              "transition-colors hover:bg-[#2563EB]/[0.035]",
              "motion-safe:animate-[apexFadeUp_0.5s_ease-out_both]",
              // round corners on outer tiles
              i === 0 && "sm:rounded-none",
              i === CAPABILITIES.length - 1 && "rounded-b-2xl",
              i === CAPABILITIES.length - 2 && "sm:rounded-bl-2xl",
            )}
          >
            <span className="mt-0.5 text-base leading-none">{cap.emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                {cap.label}
              </p>
              <p className="mt-0.5 text-[13px] leading-snug text-slate-700 transition-colors group-hover:text-slate-900">
                {cap.example}
              </p>
            </div>
            <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-200 transition-all group-hover:translate-x-0.5 group-hover:text-[#2563EB]" />
          </button>
        ))}
      </div>

      {/* Dismiss */}
      <div className="flex items-center justify-end border-t border-slate-100 px-5 py-3">
        <button
          type="button"
          onClick={dismiss}
          className="text-[12px] text-slate-400 transition-colors hover:text-slate-600"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
