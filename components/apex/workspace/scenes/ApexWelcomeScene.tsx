"use client"

import type { ReactNode } from "react"
import { Zap, Sparkles } from "lucide-react"
import { ApexIcon } from "@/components/apex/ApexIcon"
import { ApexSuggestedCommands } from "./ApexSuggestedCommands"

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
  { label: "1-click apply to my top matches",            hint: "Pre-approve a batch, Apex handles the rest", query: "Set up 1-click apply for my top matches" },
]

const SUGGESTIONS_FRESH = [
  { label: "Build my search plan",                       hint: "Practical, tailored to my profile",        query: "Create a practical search plan for me" },
  { label: "Find sponsorship-friendly roles",            hint: "Filter for visa-friendly employers",       query: "Find sponsorship-friendly roles matching my profile" },
  { label: "1-click apply to my top matches",            hint: "Pre-approve once, Apex applies for you",   query: "Set up 1-click apply for my top matches" },
]

export function ApexWelcomeScene({
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
      aria-label="Apex welcome"
      className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-10 text-center sm:pt-14 motion-safe:animate-[apexFadeUp_0.6s_ease-out_both]"
    >
      {/* Hero icon — Apex triangle mark with ambient gold glow */}
      <div className="relative mb-2 flex items-center justify-center">
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            width: 140, height: 140,
            background: "radial-gradient(circle, rgba(234,179,8,0.18) 0%, rgba(99,102,241,0.12) 50%, transparent 80%)",
            filter: "blur(18px)",
            animation: "ovenGlow 3.5s ease-in-out infinite",
          }}
        />
        <ApexIcon size={80} glow />
      </div>

      {/* Wordmark */}
      <div className="mt-5 flex items-center gap-2 motion-safe:animate-[apexFadeUp_0.5s_ease-out_30ms_both]">
        <ApexIcon size={26} />
        <span
          className="text-[13px] font-bold uppercase tracking-[0.28em] text-indigo-600"
          style={{ letterSpacing: "0.28em" }}
        >
          Apex
        </span>
        <span className="text-[11px] font-medium tracking-widest text-amber-500 opacity-80">· Applied.</span>
      </div>

      {/* Greeting */}
      <h1 className="mt-4 text-[2.5rem] font-semibold leading-[1.05] tracking-tight sm:text-[3.1rem] motion-safe:animate-[apexFadeUp_0.6s_ease-out_60ms_both]">
        <span className="text-slate-800">{greeting},&nbsp;</span>
        <span className="text-slate-950">{firstName}</span>
        <span style={{ color: "#EAB308" }}>.</span>
      </h1>

      <p className="mt-3 max-w-[440px] text-[15px] leading-relaxed text-slate-600 motion-safe:animate-[apexFadeUp_0.6s_ease-out_100ms_both]">
        Tell Apex what you&apos;re working on. It&apos;ll think it through and open the right workspace.
      </p>

      {/* Status badges */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 motion-safe:animate-[apexFadeUp_0.6s_ease-out_140ms_both]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-[11.5px] font-semibold text-indigo-700 shadow-[0_1px_2px_rgba(99,102,241,0.10)]">
          <Zap className="h-3 w-3" />
          Autonomous monitoring active
        </span>
        {hasResume && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50/90 px-3 py-1 text-[11.5px] font-semibold text-emerald-700 shadow-[0_1px_2px_rgba(16,185,129,0.10)]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Resume ready
          </span>
        )}
        {isExtensionConnected && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50/90 px-3 py-1 text-[11.5px] font-semibold text-amber-700 shadow-[0_1px_2px_rgba(234,179,8,0.10)]">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
            Browser extension live
          </span>
        )}
      </div>

      {/* Hero command input */}
      {commandSlot && (
        <div className="mt-8 w-full motion-safe:animate-[apexFadeUp_0.6s_ease-out_180ms_both]">
          {commandSlot}
        </div>
      )}

      {/* Suggested commands */}
      <div className="mt-7 w-full max-w-2xl motion-safe:animate-[apexFadeUp_0.6s_ease-out_260ms_both]">
        <p className="mb-3 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-500">
          <Sparkles className="h-3 w-3" />
          Try asking Apex
        </p>
        <ApexSuggestedCommands
          suggestions={suggestions}
          onSelect={onSuggestionClick}
        />
      </div>

      {/* Keyboard hint */}
      <p className="mt-8 text-[11px] text-slate-500/80 motion-safe:animate-[apexFadeUp_0.6s_ease-out_360ms_both]">
        Press{" "}
        <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.05)]">⌘K</kbd>{" "}
        for the command palette
      </p>
    </section>
  )
}
