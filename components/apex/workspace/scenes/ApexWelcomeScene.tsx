"use client"

import type { ReactNode } from "react"
import { Zap, Sparkles } from "lucide-react"
import { ApexIcon } from "@/components/apex/ApexIcon"
import { ApexCareerTwinCard } from "@/components/apex/ApexCareerTwinCard"
import { ApexTodayPlanCard } from "@/components/apex/ApexTodayPlanCard"
import { ApexSuggestedCommands } from "./ApexSuggestedCommands"
import type { ApexNudge } from "@/lib/apex/nudges"
import type { CareerTwinSnapshot } from "@/lib/apex/career-twin/types"
import type { ApexStrategyBoard } from "@/lib/apex/types"

type Props = {
  greeting: string
  firstName: string
  hasResume: boolean
  hasData: boolean
  isExtensionConnected: boolean
  onSuggestionClick: (query: string) => void
  onRunCommand?: (query: string) => void
  commandSlot?: ReactNode
  strategyBoard: ApexStrategyBoard | null
  strategyLoading?: boolean
  nudges?: ApexNudge[]
  careerTwin: CareerTwinSnapshot | null
  careerTwinHistory?: CareerTwinSnapshot[]
  careerTwinLoading?: boolean
  careerTwinRefreshing?: boolean
  careerTwinError?: string | null
  onRefreshCareerTwin?: () => void
  onOpenPlanHistory?: () => void
  onPlanStateCommitted?: () => void
}

const SUGGESTIONS_WITH_DATA = [
  { label: "Run today's attack plan",               hint: "Apex ranks the live queue for you",         query: "Run autonomous hunt for today" },
  { label: "Show me high-fit roles right now",          hint: "Rank by match score and freshness",       query: "Show jobs worth my time and rank them by fit" },
  { label: "Find sponsorship-friendly companies",        hint: "Recent H-1B activity, strong signal",      query: "Find sponsorship-friendly roles matching my profile" },
  { label: "Compare my top saved jobs",                  hint: "Side-by-side recommendation",              query: "Compare my top saved jobs and pick the best one" },
  { label: "Tailor my resume for the strongest match",   hint: "Targeted edits + cover letter",            query: "Tailor my resume for my strongest match" },
  { label: "1-click apply to my top matches",            hint: "Pre-approve a batch, Apex handles the rest", query: "Set up 1-click apply for my top matches" },
]

const SUGGESTIONS_FRESH = [
  { label: "Run today's attack plan",               hint: "Apex builds your starting queue",            query: "Run autonomous hunt for today" },
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
  onRunCommand,
  commandSlot,
  strategyBoard,
  strategyLoading = false,
  nudges = [],
  careerTwin,
  careerTwinHistory = [],
  careerTwinLoading = false,
  careerTwinRefreshing = false,
  careerTwinError = null,
  onRefreshCareerTwin,
  onOpenPlanHistory,
  onPlanStateCommitted,
}: Props) {
  const suggestions = hasData ? SUGGESTIONS_WITH_DATA : SUGGESTIONS_FRESH

  return (
    <section
      aria-label="Apex welcome"
      className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8 motion-safe:animate-[apexFadeUp_0.6s_ease-out_both]"
    >
      <div className="motion-safe:animate-[apexFadeUp_0.5s_ease-out_30ms_both]">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_auto] xl:items-end">
          <div className="flex items-start gap-4">
            <div className="relative flex-shrink-0">
              <div
                className="pointer-events-none absolute inset-[-12px] rounded-full"
                style={{
                  background: "radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(234,179,8,0.08) 55%, transparent 80%)",
                  filter: "blur(14px)",
                }}
              />
              <ApexIcon size={54} glow />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-600">Apex</span>
                <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Career Operator</span>
              </div>
              <h1 className="mt-3 max-w-3xl text-[2rem] font-semibold leading-[1.08] tracking-tight text-slate-950 sm:text-[2.45rem] motion-safe:animate-[apexFadeUp_0.6s_ease-out_60ms_both]">
                {greeting}, {firstName}. Start from the highest-leverage move.
              </h1>
              <p className="mt-3 max-w-2xl text-[14px] leading-6 text-slate-600 motion-safe:animate-[apexFadeUp_0.6s_ease-out_100ms_both]">
                {hasData
                  ? "Apex already has a live read on your search. Launch the next workspace, rank the queue, or act on the sharpest recommendation."
                  : "Tell Apex the role, constraint, or company you care about. It will open the right workspace and structure the next move."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 motion-safe:animate-[apexFadeUp_0.6s_ease-out_140ms_both] xl:justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
              <Zap className="h-3 w-3" />
              Monitoring active
            </span>
            {hasResume && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-emerald-700 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Resume ready
              </span>
            )}
            {isExtensionConnected && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white/90 px-3 py-1 text-[11px] font-semibold text-amber-700 shadow-[0_4px_18px_rgba(15,23,42,0.04)]">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                Extension live
              </span>
            )}
          </div>
        </div>

        {commandSlot && (
          <div className="mt-6 w-full motion-safe:animate-[apexFadeUp_0.6s_ease-out_180ms_both]">
            {commandSlot}
          </div>
        )}

        <div className="mt-6 motion-safe:animate-[apexFadeUp_0.6s_ease-out_220ms_both]">
          <p className="mb-3 inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            <Sparkles className="h-3 w-3" />
            Launch Fast
          </p>
          <ApexSuggestedCommands
            suggestions={suggestions}
            onSelect={onSuggestionClick}
            className="xl:grid-cols-3"
          />
        </div>
      </div>

      <div className="mt-5 grid w-full gap-4 text-left motion-safe:animate-[apexFadeUp_0.6s_ease-out_260ms_both] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <ApexTodayPlanCard
          board={strategyBoard}
          nudges={nudges}
          isLoading={strategyLoading}
          hasData={hasData}
          onActionClick={onRunCommand}
          onOpenHistory={onOpenPlanHistory}
          onPlanStateCommitted={onPlanStateCommitted}
          twin={careerTwin}
          history={careerTwinHistory}
          variant="summary"
        />
        <ApexCareerTwinCard
          twin={careerTwin}
          history={careerTwinHistory}
          isLoading={careerTwinLoading}
          isRefreshing={careerTwinRefreshing}
          error={careerTwinError}
          onRefresh={onRefreshCareerTwin}
          onRunFocus={onRunCommand}
          variant="summary"
        />
      </div>

      {/* Keyboard hint */}
      <p className="mt-4 text-center text-[11px] text-slate-500/80 motion-safe:animate-[apexFadeUp_0.6s_ease-out_320ms_both]">
        Press{" "}
        <kbd className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 shadow-[0_1px_0_rgba(15,23,42,0.05)]">⌘K</kbd>{" "}
        for the command palette
      </p>
    </section>
  )
}
