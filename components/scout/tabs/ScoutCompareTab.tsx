"use client"

import {
  ArrowRight,
  BarChart3,
  Briefcase,
  CheckCircle2,
  GitCompare,
  Layers,
  Loader2,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react"

import { ScoutCompareRenderer } from "@/components/scout/ScoutCompareRenderer"
import type { ScoutCompareResponse } from "@/lib/scout/types"

export type ScoutCompareTabProps = {
  compareResponse: ScoutCompareResponse | null
  onRunCompareCommand: (message: string) => void
  isLoading?: boolean
  error?: string | null
}

const COMPARE_PROMPTS = [
  {
    icon: Briefcase,
    title: "Compare saved jobs",
    description: "Rank jobs you already saved by match, risk, and sponsorship signals.",
    chip: "Compare my saved jobs",
  },
  {
    icon: Target,
    title: "Pick the best role",
    description: "Ask Scout which job deserves your time first.",
    chip: "Which job should I apply to first?",
  },
  {
    icon: Scale,
    title: "Tradeoff view",
    description: "Compare match, salary, location, sponsorship, and application risk.",
    chip: "Compare these jobs by tradeoffs",
  },
]

function CompareEmptyState({
  onRunCompareCommand,
  isLoading,
}: {
  onRunCompareCommand: (message: string) => void
  isLoading: boolean
}) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="p-5 sm:p-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-orange-700">
            <GitCompare className="h-3.5 w-3.5" />
            Compare ready
          </div>
          <h3 className="mt-4 text-xl font-bold tracking-tight text-slate-950">
            Compare jobs before you spend time applying
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Scout can compare jobs side by side using the data Hireoven already has: match score,
            company signals, sponsorship context, salary, location, and risk.
          </p>

          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {COMPARE_PROMPTS.map((prompt) => {
              const Icon = prompt.icon
              return (
                <button
                  key={prompt.title}
                  type="button"
                  disabled={isLoading}
                  onClick={() => onRunCompareCommand(prompt.chip)}
                  className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50/60 hover:shadow-md disabled:pointer-events-none disabled:opacity-50"
                >
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-orange-700 shadow-sm">
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="mt-3 text-sm font-bold text-slate-950">{prompt.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{prompt.description}</p>
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-orange-600">
                    Start compare
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <aside className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0 sm:p-6">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
            <BarChart3 className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-bold text-slate-950">Best for decisions</p>
          <div className="mt-3 space-y-3">
            {[
              "Which saved job is strongest?",
              "Which role has less risk?",
              "Which job should I tailor for first?",
            ].map((item) => (
              <div
                key={item}
                className="flex items-start gap-2 rounded-2xl bg-white px-3 py-2.5 shadow-sm"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                <p className="text-xs leading-5 text-slate-600">{item}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}

function CompareResultHeader({
  compare,
  onRunCompareCommand,
  isLoading,
}: {
  compare: ScoutCompareResponse
  onRunCompareCommand: (message: string) => void
  isLoading: boolean
}) {
  const itemCount = compare.items?.length ?? 0
  const hasWinner = Boolean(compare.winnerJobId)

  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-5 p-5 sm:p-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
            <GitCompare className="h-3.5 w-3.5" />
            Compare result
          </div>
          <h3 className="mt-4 text-xl font-bold tracking-tight text-slate-950">
            Job comparison summary
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            {compare.summary ||
              "Scout compared the available jobs using existing Hireoven signals."}
          </p>
        </div>

        <div className="flex flex-col items-end gap-3">
          <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <div className="rounded-xl bg-white px-4 py-3 text-center shadow-sm">
              <BarChart3 className="mx-auto h-4 w-4 text-orange-600" />
              <p className="mt-1 text-lg font-bold text-slate-950">{itemCount}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Jobs
              </p>
            </div>
            <div className="rounded-xl bg-white px-4 py-3 text-center shadow-sm">
              <Trophy className="mx-auto h-4 w-4 text-amber-500" />
              <p className="mt-1 text-lg font-bold text-slate-950">{hasWinner ? "Yes" : "—"}</p>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                Winner
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => onRunCompareCommand("Compare my saved jobs")}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-orange-300 hover:text-orange-700 disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <GitCompare className="h-3 w-3" />
            )}
            Re-compare
          </button>
        </div>
      </div>
    </section>
  )
}

export function ScoutCompareTab({
  compareResponse,
  onRunCompareCommand,
  isLoading = false,
  error = null,
}: ScoutCompareTabProps) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-44 w-44 rounded-full bg-orange-100/70 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-44 w-44 rounded-full bg-blue-100/60 blur-3xl" />

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-orange-700 shadow-sm">
              <Layers className="h-3.5 w-3.5" />
              Compare
            </div>
            <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
              Compare opportunities
            </h2>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
              Put jobs side by side so Scout can help you choose the best next move before you spend time applying.
            </p>
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => onRunCompareCommand("Compare my saved jobs")}
            className="inline-flex items-center gap-2 rounded-2xl bg-orange-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60"
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {isLoading ? "Comparing…" : "Start compare"}
          </button>
        </div>

        <div className="relative mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
            <GitCompare className="h-4 w-4 text-orange-600" />
            <p className="mt-2 text-xs font-bold text-slate-900">Side-by-side decisions</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">Compare multiple jobs without jumping pages.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <p className="mt-2 text-xs font-bold text-slate-900">Grounded signals</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">Uses stored match, company, and sponsorship data.</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 shadow-sm">
            <Trophy className="h-4 w-4 text-amber-500" />
            <p className="mt-2 text-xs font-bold text-slate-900">Pick a winner</p>
            <p className="mt-1 text-[11px] leading-4 text-slate-500">Highlight the job worth acting on first.</p>
          </div>
        </div>
      </section>

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Loading overlay when no result yet */}
      {isLoading && !compareResponse && (
        <section className="flex flex-col items-center gap-4 rounded-3xl border border-slate-200 bg-white py-16 shadow-sm">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-600">
            <Sparkles className="h-6 w-6 animate-pulse text-white" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-800">Scout is comparing your jobs…</p>
            <p className="mt-0.5 text-xs text-slate-400">
              Reading saved jobs, match scores, and sponsorship signals.
            </p>
          </div>
        </section>
      )}

      {/* Content */}
      {!isLoading || compareResponse ? (
        !compareResponse ? (
          <CompareEmptyState
            onRunCompareCommand={onRunCompareCommand}
            isLoading={isLoading}
          />
        ) : (
          <>
            <CompareResultHeader
              compare={compareResponse}
              onRunCompareCommand={onRunCompareCommand}
              isLoading={isLoading}
            />
            <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 px-5 py-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Comparison Table
                </p>
                <h3 className="mt-1 text-lg font-bold tracking-tight text-slate-950">
                  Jobs side by side
                </h3>
              </div>
              <div className="p-5">
                <ScoutCompareRenderer compare={compareResponse} />
              </div>
            </section>
          </>
        )
      ) : null}
    </div>
  )
}
