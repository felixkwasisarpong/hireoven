"use client"

import type { ReactNode } from "react"
import { Cpu, Sparkles } from "lucide-react"
import { ScoutOrb } from "@/components/scout/ScoutOrb"
import { ScoutSuggestedCommands } from "./ScoutSuggestedCommands"

type Props = {
  greeting: string
  firstName: string
  hasResume: boolean
  hasData: boolean
  isExtensionConnected: boolean
  onSuggestionClick: (query: string) => void
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
      {/* Ambient orb glow + orb */}
      <div className="relative mb-2 flex items-center justify-center">
        {/* Outer ambient halo */}
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            width: 170, height: 170,
            background: "radial-gradient(circle, rgba(59,130,246,0.26) 0%, rgba(14,165,233,0.16) 42%, rgba(99,102,241,0.08) 70%, transparent 84%)",
            filter: "blur(20px)",
            animation: "ovenGlow 3.5s ease-in-out infinite",
          }}
        />
        {/* Mid ring */}
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            width: 120, height: 120,
            border: "1px solid rgba(59,130,246,0.22)",
            animation: "ovenHeatRing 3.5s ease-out 0.8s infinite",
          }}
        />
        <ScoutOrb size="lg" state="idle" useGif className="h-24 w-24" />
      </div>

      {/* Greeting */}
      <h1 className="mt-6 text-[2.5rem] font-semibold leading-[1.05] tracking-tight sm:text-[3.1rem] motion-safe:animate-[scoutFadeUp_0.6s_ease-out_60ms_both]">
        <span className="text-slate-800">{greeting},&nbsp;</span>
        <span className="text-slate-950">{firstName}</span>
        <span className="text-[#2563EB]">.</span>
      </h1>

      <p className="mt-3 max-w-[440px] text-[15px] leading-relaxed text-slate-600 motion-safe:animate-[scoutFadeUp_0.6s_ease-out_100ms_both]">
        Tell Scout what you&apos;re working on. It&apos;ll think it through and open the right workspace.
      </p>

      {/* Status badges */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 motion-safe:animate-[scoutFadeUp_0.6s_ease-out_140ms_both]">
        {/* Always-on autonomous monitoring badge */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11.5px] font-semibold text-blue-700 shadow-[0_1px_2px_rgba(37,99,235,0.10)]">
          <Cpu className="h-3 w-3" />
          Autonomous monitoring active
        </span>
        {hasResume && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[11.5px] font-semibold text-emerald-700 shadow-[0_1px_2px_rgba(16,185,129,0.10)]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Resume ready
          </span>
        )}
        {isExtensionConnected && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50/90 px-3 py-1 text-[11.5px] font-semibold text-sky-700 shadow-[0_1px_2px_rgba(14,165,233,0.10)]">
            <span className="h-1.5 w-1.5 rounded-full bg-sky-500 animate-pulse" />
            Browser extension live
          </span>
        )}
      </div>

      {/* Hero command input */}
      {commandSlot && (
        <div className="mt-8 w-full motion-safe:animate-[scoutFadeUp_0.6s_ease-out_180ms_both]">
          {commandSlot}
        </div>
      )}

      {/* Suggested commands */}
      <div className="mt-7 w-full max-w-2xl motion-safe:animate-[scoutFadeUp_0.6s_ease-out_260ms_both]">
        <p className="mb-3 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          <Sparkles className="h-3 w-3" />
          Try asking Scout
        </p>
        <ScoutSuggestedCommands
          suggestions={suggestions}
          onSelect={onSuggestionClick}
        />
      </div>

      {/* Keyboard hint */}
      <p className="mt-8 text-[11px] text-slate-500/80 motion-safe:animate-[scoutFadeUp_0.6s_ease-out_360ms_both]">
        Press{" "}
        <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.05)]">⌘K</kbd>{" "}
        for the command palette
      </p>
    </section>
  )
}
