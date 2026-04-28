"use client"

import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  Target,
  TrendingUp,
  Activity,
  Users,
} from "lucide-react"
import { useFeatureAccess } from "@/lib/hooks/useFeatureAccess"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { getDefaultActionLabel } from "@/lib/scout/actions"
import type { ScoutAction, ScoutStrategyBoard } from "@/lib/scout/types"
import { useScoutActionExecutor } from "./useScoutActionExecutor"

type ScoutStrategyBoardProps = {
  board: ScoutStrategyBoard | null
  isLoading: boolean
  error: string | null
}

const RISK_CONFIG = {
  high:   { bar: "bg-red-500",    pill: "border-red-200 bg-red-50 text-red-800",       dot: "bg-red-500" },
  medium: { bar: "bg-amber-500",  pill: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-400" },
  low:    { bar: "bg-slate-300",  pill: "border-slate-200 bg-slate-50 text-slate-700", dot: "bg-slate-300" },
} as const

export function ScoutStrategyBoard({ board, isLoading, error }: ScoutStrategyBoardProps) {
  const { hasAccess: hasStrategyAccess } = useFeatureAccess("scout_strategy")
  const { hasAccess: hasActionAccess } = useFeatureAccess("scout_actions")
  const { showUpgrade } = useUpgradeModal()
  const { executeAction, feedback } = useScoutActionExecutor()

  if (isLoading) {
    return (
      <section className="rounded-[20px] border border-slate-200/80 bg-white p-8 shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
        <div className="flex flex-col items-center justify-center gap-3 py-4 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-blue-500" />
          <p className="text-sm font-medium text-slate-500">Building your strategy board…</p>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-[20px] border border-red-200 bg-red-50 p-5">
        <p className="text-sm font-semibold text-red-700">Could not load strategy board</p>
        <p className="mt-1 text-xs text-red-600">{error}</p>
      </section>
    )
  }

  if (!board) {
    return (
      <section className="rounded-[20px] border border-slate-200/80 bg-white p-6 shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
        <p className="text-sm font-semibold text-slate-900">Strategy board unavailable</p>
        <p className="mt-1 text-xs text-slate-500">Ask Scout for guidance while we gather your signals.</p>
      </section>
    )
  }

  const hasSnapshotData =
    board.snapshot.savedJobs > 0 ||
    board.snapshot.activeApplications > 0 ||
    board.snapshot.recentApplications > 0 ||
    board.snapshot.averageMatchScore !== null

  const hasOnboardingGap = board.risks.some(
    (r) => r.id === "missing-resume-context" || r.id === "empty-preferences"
  )

  return (
    <section className="space-y-4">
      {/* ── Board header ── */}
      <div className="rounded-[20px] border border-slate-200/80 bg-white px-6 py-5 shadow-[0_2px_16px_rgba(15,23,42,0.06)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-500">
              Strategy board
            </p>
            <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900">
              What Hireoven already knows
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Deterministic snapshot — profile · applications · resumes · matches · watchlist · alerts
            </p>
          </div>
          {!hasStrategyAccess && (
            <button
              type="button"
              onClick={() => showUpgrade("scout_strategy")}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100"
            >
              <Lock className="h-3 w-3" />
              Unlock deep strategy
            </button>
          )}
        </div>
      </div>

      {/* ── Top row: Today's Focus + Snapshot ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Today's Focus */}
        <article className="rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-blue-50">
              <Target className="h-4 w-4 text-blue-600" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Today's Focus</p>
          </div>
          <ul className="mt-4 space-y-2.5">
            {board.todayFocus.map((focus) => (
              <li key={focus} className="flex items-start gap-2.5">
                <span className="mt-[5px] inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-400" />
                <span className="text-sm leading-6 text-slate-700">{focus}</span>
              </li>
            ))}
            {board.todayFocus.length === 0 && (
              <li className="text-sm text-slate-400">Nothing specific for today — keep searching!</li>
            )}
          </ul>
        </article>

        {/* Snapshot metrics */}
        <article className="lg:col-span-2 rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-orange-50">
              <Activity className="h-4 w-4 text-orange-600" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Job Search Snapshot</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <SnapshotMetric
              label="Saved Jobs"
              value={board.snapshot.savedJobs}
              icon={<Users className="h-3.5 w-3.5 text-slate-400" />}
            />
            <SnapshotMetric
              label="Active Apps"
              value={board.snapshot.activeApplications}
              icon={<TrendingUp className="h-3.5 w-3.5 text-slate-400" />}
            />
            <SnapshotMetric
              label="Recent Apps"
              value={board.snapshot.recentApplications}
              sub="last 14 days"
            />
            <SnapshotMetric
              label="Avg Match"
              value={board.snapshot.averageMatchScore !== null ? `${board.snapshot.averageMatchScore}%` : "—"}
              highlight={
                board.snapshot.averageMatchScore !== null && board.snapshot.averageMatchScore >= 70
              }
            />
          </div>
          {!hasSnapshotData && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
              Add a resume, save target companies, and track applications to see useful strategy signals here.
            </div>
          )}
        </article>
      </div>

      {/* ── Bottom row: Risks + Next Moves ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Risks */}
        <article className="rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-red-50">
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Weak Signals / Risks</p>
          </div>
          {board.risks.length === 0 ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              No major risk signals right now.
            </div>
          ) : (
            <div className="mt-4 space-y-2.5">
              {board.risks.map((risk) => {
                const cfg = RISK_CONFIG[risk.severity]
                return (
                  <div
                    key={risk.id}
                    className={`relative overflow-hidden rounded-xl border px-4 py-3 ${cfg.pill}`}
                  >
                    <div className={`absolute left-0 top-0 h-full w-1 ${cfg.bar}`} />
                    <div className="pl-1">
                      <p className="text-sm font-semibold">{risk.title}</p>
                      <p className="mt-0.5 text-xs leading-5 opacity-80">{risk.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </article>

        {/* Next Moves */}
        <article className="rounded-[18px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_4px_16px_rgba(15,23,42,0.04)]">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-50">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Recommended Next Moves</p>
          </div>
          <div className="mt-4 space-y-2.5">
            {board.nextMoves.map((move, idx) => {
              const action = move.action
              const actionLocked = action?.type === "OPEN_RESUME_TAILOR" && !hasActionAccess
              return (
                <div
                  key={move.id}
                  className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
                >
                  <div className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-500 shadow-[0_0_0_1px_rgba(15,23,42,0.08)]">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{move.title}</p>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">{move.description}</p>
                    {action && (
                      <button
                        type="button"
                        onClick={() => {
                          if (actionLocked) {
                            showUpgrade("scout_actions")
                            return
                          }
                          executeAction(action)
                        }}
                        className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          actionLocked
                            ? "border-amber-300 bg-white text-amber-700 hover:bg-amber-50"
                            : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
                        }`}
                      >
                        {actionLocked && <Lock className="h-3 w-3" />}
                        {actionLocked ? "Unlock action" : action.label || getDefaultActionLabel(action as ScoutAction)}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
            {board.nextMoves.length === 0 && (
              <p className="text-xs text-slate-400">No deterministic next moves yet. Complete profile and resume setup first.</p>
            )}
          </div>
          {feedback && (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {feedback}
            </div>
          )}
          {!hasActionAccess && (
            <p className="mt-3 text-[11px] text-amber-700">
              Resume tailoring actions are on paid Scout plans.
            </p>
          )}
        </article>
      </div>

      {/* ── Onboarding gap banner ── */}
      {hasOnboardingGap && (
        <div className="flex items-start gap-3 rounded-[18px] border border-blue-200 bg-blue-50 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
          <div>
            <p className="text-sm font-semibold text-blue-900">Onboarding signals are incomplete</p>
            <p className="mt-0.5 text-xs text-blue-700">
              Fill out your resume context and profile preferences to improve Scout recommendations.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function SnapshotMetric({
  label,
  value,
  sub,
  icon,
  highlight,
}: {
  label: string
  value: number | string
  sub?: string
  icon?: React.ReactNode
  highlight?: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
        {icon}
      </div>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight ${highlight ? "text-emerald-600" : "text-slate-900"}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
    </div>
  )
}
