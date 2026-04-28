// FRESH REDESIGN, frontend-first, no dependencies on old components.
"use client"

import {
  ArrowRight,
  Brain,
  Clock3,
  Compass,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react"
import { useState } from "react"

type GeneratedStrategy = {
  focus?: string[]
  prioritize?: string[]
  avoid?: string[]
  improve?: string[]
  thisWeek?: string[]
}

type NormalizedMove = {
  id: string
  title: string
  description: string
}

type NormalizedSignal = {
  id: string
  title: string
  description: string
}
import type { ScoutStrategyBoard as ScoutStrategyBoardData } from "@/lib/scout/types"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"

export type ScoutStrategyTabProps = {
  board: ScoutStrategyBoardData | null
  isLoading: boolean
  error: string | null
  behaviorSignals: ScoutBehaviorSignals | null
  behaviorLoading: boolean
}


function SnapshotItem({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  icon: typeof Target
  tone: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <div className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        <p className="truncate text-sm font-bold text-slate-950">{value}</p>
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-500 shadow-sm">
      {children}
    </span>
  )
}

function LoadingLines() {
  return (
    <div className="space-y-2">
      <div className="h-3 w-3/4 animate-pulse rounded-full bg-slate-100" />
      <div className="h-3 w-full animate-pulse rounded-full bg-slate-100" />
      <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-100" />
    </div>
  )
}

export function ScoutStrategyTab({
  board,
  isLoading,
  error,
  behaviorSignals,
  behaviorLoading,
}: ScoutStrategyTabProps) {
  const [generatedStrategy, setGeneratedStrategy] = useState<GeneratedStrategy | null>(null)
  const [isGeneratingStrategy, setIsGeneratingStrategy] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const generatedFocus = generatedStrategy?.focus?.slice(0, 4) ?? []
  const generatedMoves: NormalizedMove[] = [
    ...(generatedStrategy?.prioritize ?? []).map((item, index) => ({
      id: `generated-prioritize-${index}`,
      title: item,
      description: "Priority from generated strategy.",
    })),
    ...(generatedStrategy?.thisWeek ?? []).map((item, index) => ({
      id: `generated-this-week-${index}`,
      title: item,
      description: "Action for this week from generated strategy.",
    })),
  ].slice(0, 4)
  const generatedWeakSignals: NormalizedSignal[] = [
    ...(generatedStrategy?.avoid ?? []).map((item, index) => ({
      id: `generated-avoid-${index}`,
      title: item,
      description: "Avoid signal from generated strategy.",
    })),
    ...(generatedStrategy?.improve ?? []).map((item, index) => ({
      id: `generated-improve-${index}`,
      title: item,
      description: "Improvement area from generated strategy.",
    })),
  ].slice(0, 4)

  const focusItems = generatedFocus.length > 0 ? generatedFocus : board?.todayFocus?.slice(0, 4) ?? []
  const nextMoves: NormalizedMove[] = generatedMoves.length > 0
    ? generatedMoves
    : (board?.nextMoves?.slice(0, 4).map((move, index) => ({
        id: move.id ?? `board-next-move-${index}`,
        title: move.title,
        description: move.description,
      })) ?? [])
  const weakSignals: NormalizedSignal[] = generatedWeakSignals.length > 0
    ? generatedWeakSignals
    : (board?.weakSignals?.slice(0, 4).map((signal, index) => ({
        id: signal.id ?? `board-weak-signal-${index}`,
        title: signal.title,
        description: signal.description,
      })) ?? [])
  const strategySource = generatedStrategy ? "Generated strategy" : "Current data"

  const hasSignals = Boolean(
    behaviorSignals &&
      ((behaviorSignals.preferredRoles?.length ?? 0) > 0 ||
        (behaviorSignals.commonSkills?.length ?? 0) > 0 ||
        behaviorSignals.sponsorshipSensitivity !== "unknown")
  )

  async function handleGenerateStrategy() {
    setIsGeneratingStrategy(true)
    setGenerateError(null)

    try {
      const response = await fetch("/api/scout/strategy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pagePath: "/dashboard/scout" }),
      })

      if (!response.ok) {
        throw new Error("Strategy generation failed")
      }

      const data = await response.json()
      const strategy = data.strategy ?? data

      setGeneratedStrategy({
        focus: Array.isArray(strategy.focus) ? strategy.focus : [],
        prioritize: Array.isArray(strategy.prioritize) ? strategy.prioritize : [],
        avoid: Array.isArray(strategy.avoid) ? strategy.avoid : [],
        improve: Array.isArray(strategy.improve) ? strategy.improve : [],
        thisWeek: Array.isArray(strategy.thisWeek) ? strategy.thisWeek : [],
      })
    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "Strategy generation failed")
    } finally {
      setIsGeneratingStrategy(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-100 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-orange-700 shadow-sm">
            <Brain className="h-3.5 w-3.5" />
            Strategy
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Your job-search command plan
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Scout turns your current signals into a simple plan: what to focus on, what to avoid, and what to do next.
          </p>
        </div>

        <button
          type="button"
          onClick={handleGenerateStrategy}
          disabled={isGeneratingStrategy}
          className="inline-flex items-center gap-2 rounded-2xl bg-orange-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-orange-700 disabled:opacity-60"
        >
          <Sparkles className={`h-3.5 w-3.5 ${isGeneratingStrategy ? "animate-spin" : ""}`} />
          {isGeneratingStrategy ? "Generating..." : generatedStrategy ? "Regenerate strategy" : "Generate strategy"}
        </button>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
              Strategy Snapshot
            </p>
            <p className="mt-0.5 text-xs text-slate-500">One compact view of the signals powering this plan.</p>
          </div>
          <Pill>
            <Clock3 className="mr-1.5 h-3 w-3" />
            {strategySource}
          </Pill>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SnapshotItem
            label="Focus"
            value={focusItems.length > 0 ? `${focusItems.length} priorities` : "Best targets"}
            icon={Compass}
            tone="bg-orange-50 text-orange-700"
          />
          <SnapshotItem
            label="Signals"
            value={hasSignals ? "Personalized" : "Learning"}
            icon={TrendingUp}
            tone="bg-emerald-50 text-emerald-700"
          />
          <SnapshotItem
            label="Risk"
            value={weakSignals.length > 0 ? `${weakSignals.length} warnings` : "Low noise"}
            icon={ShieldCheck}
            tone="bg-amber-50 text-amber-700"
          />
          <SnapshotItem
            label="Plan"
            value={nextMoves.length > 0 ? `${nextMoves.length} moves` : "This week"}
            icon={Zap}
            tone="bg-blue-50 text-blue-700"
          />
        </div>
      </section>

      {(error || generateError) && (
        <section className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {generateError ?? error}
        </section>
      )}

      <section className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Strategy Plan
                </p>
                <h3 className="mt-1 text-lg font-bold tracking-tight text-slate-950">
                  Focus and execution in one place
                </h3>
              </div>
              <Pill>
                <Target className="mr-1.5 h-3 w-3" />
                {strategySource}
              </Pill>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Today&apos;s Focus
                  </p>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {generatedStrategy ? "strategy.focus" : "board.todayFocus"}
                  </span>
                </div>

                <div className="space-y-3">
                  {isLoading ? (
                    [1, 2, 3].map((item) => (
                      <div key={item} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                        <LoadingLines />
                      </div>
                    ))
                  ) : focusItems.length > 0 ? (
                    focusItems.map((focus, index) => (
                      <article
                        key={focus}
                        className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 transition hover:border-orange-200 hover:bg-orange-50/40"
                      >
                        <div className="flex items-start gap-3">
                          <div className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-orange-600 text-xs font-bold text-white">
                            {index + 1}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-950">{focus}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-500">
                              {generatedStrategy ? "Generated by Strategy Mode." : "Priority generated from your current Scout board."}
                            </p>
                          </div>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                      Scout needs more saved jobs, applications, or resume context to build a stronger focus list.
                    </div>
                  )}
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Recommended Next Moves
                  </p>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {generatedStrategy ? "strategy.prioritize + strategy.thisWeek" : "board.nextMoves"}
                  </span>
                </div>

                <div className="space-y-3">
                  {isLoading ? (
                    <LoadingLines />
                  ) : nextMoves.length > 0 ? (
                    nextMoves.map((move, index) => (
                      <div
                        key={move.id ?? `${move.title}-${index}`}
                        className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md"
                      >
                        <div className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs font-bold text-slate-600">
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-950">{move.title}</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">{move.description}</p>
                        </div>
                        <ArrowRight className="mt-2 h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-orange-600" />
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                      No execution moves yet. Add or save jobs so Scout can build the plan.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Avoid & Improve
                </p>
                <h3 className="mt-1 text-base font-bold text-slate-950">What to avoid and fix next</h3>
              </div>
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-100 bg-amber-50 text-amber-700">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>

            <div className="mt-4 space-y-5">
              <div>
                <div>
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                    Avoid / Improve
                  </p>
                  <div>
                    <div className="space-y-2">
                      {isLoading ? (
                        <LoadingLines />
                      ) : weakSignals.length > 0 ? (
                        weakSignals.map((signal) => (
                          <div key={signal.id ?? signal.title} className="rounded-2xl border border-amber-100 bg-amber-50/70 px-3 py-2.5">
                            <p className="text-xs font-bold text-amber-800">{signal.title}</p>
                            <p className="mt-1 text-xs leading-5 text-amber-700">{signal.description}</p>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">
                          No avoid or improve items yet. Generate a strategy to populate this area.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </aside>
      </section>
    </div>
  )
}