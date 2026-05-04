"use client"

import type { ReactNode } from "react"
import { Sparkles } from "lucide-react"
import { ScoutOrb } from "@/components/scout/ScoutOrb"
import { ScoutSuggestedCommands } from "./ScoutSuggestedCommands"

type Props = {
  greeting: string
  firstName: string
  hasResume: boolean
  hasData: boolean
  isExtensionConnected: boolean
  onSuggestionClick: (query: string) => void
  /** The shell renders the actual ScoutCommandBar here so all state/handlers stay wired. */
  commandSlot?: ReactNode
}

const SUGGESTIONS_WITH_DATA = [
  { label: "Show me high-fit roles right now",          hint: "Rank by match score and freshness",       query: "Show jobs worth my time and rank them by fit" },
  { label: "Find sponsorship-friendly companies",        hint: "Recent H-1B activity, strong signal",      query: "Find sponsorship-friendly roles matching my profile" },
  { label: "Compare my top saved jobs",                  hint: "Side-by-side recommendation",              query: "Compare my top saved jobs and pick the best one" },
  { label: "Tailor my resume for the strongest match",   hint: "Targeted edits + cover letter",            query: "Tailor my resume for my strongest match" },
]

const SUGGESTIONS_FRESH = [
  { label: "Build my search plan",                       hint: "Practical, tailored to my profile",        query: "Create a practical search plan for me" },
  { label: "Find sponsorship-friendly roles",            hint: "Filter for visa-friendly employers",       query: "Find sponsorship-friendly roles matching my profile" },
]

export function ScoutWelcomeScene({
  greeting,
  firstName,
  hasResume,
  hasData,
  isExtensionConnected,
  onSuggestionClick,
  commandSlot,
}: Props) {
  const suggestions = hasData ? SUGGESTIONS_WITH_DATA : SUGGESTIONS_FRESH

  return (
    <section
      aria-label="Scout welcome"
      className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-10 text-center sm:pt-14 motion-safe:animate-[scoutFadeUp_0.6s_ease-out_both]"
    >
      {/* Premium animated orb — Scout is alive */}
      <ScoutOrb size="lg" state="idle" className="mb-4" />

      {/* Status pill */}
      <div className="inline-flex items-center gap-2 rounded-full border border-[#FFD5C2] bg-[#FFF8F5]/80 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#FF5C18] backdrop-blur">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF5C18] opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#FF5C18]" />
        </span>
        Scout · Ready
      </div>

      {/* Greeting */}
      <h1 className="mt-5 text-[2.4rem] font-semibold leading-[1.05] tracking-tight text-slate-900 sm:text-[3rem]">
        {greeting}, <span className="text-slate-950">{firstName}</span>
        <span className="text-[#FF5C18]">.</span>
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-slate-500">
        Tell Scout what you&apos;re working on. It&apos;ll think it through and open the right workspace.
      </p>

      {/* Hero command input — fed by the shell so all wiring is preserved */}
      {commandSlot && (
        <div className="mt-7 w-full motion-safe:animate-[scoutFadeUp_0.6s_ease-out_120ms_both]">
          {commandSlot}
        </div>
      )}

      {/* Tiny readiness hints */}
      {(hasResume || isExtensionConnected) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5 text-[11.5px] text-slate-400 motion-safe:animate-[scoutFadeUp_0.6s_ease-out_180ms_both]">
          {hasResume && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50/60 px-2.5 py-1 font-medium text-emerald-700">
              <span className="h-1 w-1 rounded-full bg-emerald-500" /> Resume ready
            </span>
          )}
          {isExtensionConnected && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50/60 px-2.5 py-1 font-medium text-sky-700">
              <span className="h-1 w-1 rounded-full bg-sky-500" /> Browser extension live
            </span>
          )}
        </div>
      )}

      {/* Suggested commands — single row of compact chips, calm */}
      <div className="mt-7 w-full max-w-2xl motion-safe:animate-[scoutFadeUp_0.6s_ease-out_240ms_both]">
        <p className="mb-2.5 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          <Sparkles className="h-3 w-3" />
          Try asking Scout
        </p>
        <ScoutSuggestedCommands
          suggestions={suggestions}
          onSelect={onSuggestionClick}
        />
      </div>

      {/* Subtle keyboard hint */}
      <p className="mt-8 text-[11px] text-slate-400 motion-safe:animate-[scoutFadeUp_0.6s_ease-out_320ms_both]">
        Press{" "}
        <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.04)]">⌘K</kbd>{" "}
        for the command palette
      </p>
    </section>
  )
}
