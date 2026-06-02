"use client"

import {
  AlertTriangle,
  Brain,
  Loader2,
  Minus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { useMemo } from "react"
import type { CareerTwinSnapshot } from "@/lib/apex/career-twin/types"
import { JOB_SECTOR_LABELS, ROLE_CATEGORY_LABELS } from "@/lib/apex/outcomes/categorizers"

type DriftTone = "positive" | "warning" | "neutral"

type DriftItem = {
  id: string
  text: string
  tone: DriftTone
}

type Props = {
  twin: CareerTwinSnapshot | null
  history?: CareerTwinSnapshot[]
  isLoading?: boolean
  isRefreshing?: boolean
  error?: string | null
  onRefresh?: () => void
  onRunFocus?: (query: string) => void
  variant?: "compact" | "full" | "summary"
}

function MetricBar({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: "orange" | "blue"
}) {
  const color = tone === "orange" ? "bg-orange-500" : "bg-blue-500"

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>
        <span className="text-[11px] font-semibold tabular-nums text-slate-600">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function roleLabel(snapshot: CareerTwinSnapshot | null): string | null {
  if (!snapshot?.primaryRoleCategory) return null
  return ROLE_CATEGORY_LABELS[snapshot.primaryRoleCategory] ?? snapshot.primaryRoleCategory
}

function sectorLabel(snapshot: CareerTwinSnapshot | null): string | null {
  if (!snapshot?.primarySector) return null
  return JOB_SECTOR_LABELS[snapshot.primarySector] ?? snapshot.primarySector
}

function getDimension(snapshot: CareerTwinSnapshot | null, key: string) {
  return snapshot?.dimensions.find((dimension) => dimension.key === key) ?? null
}

function executionToneClasses(direction: "strength" | "risk" | "constraint" | "neutral", score: number) {
  if (direction === "strength" || score >= 70) {
    return {
      shell: "border-emerald-200 bg-emerald-50/70",
      badge: "border-emerald-200 bg-white text-emerald-700",
      text: "text-emerald-900",
      subtext: "text-emerald-800/80",
      label: "Holding",
    }
  }

  if (direction === "risk" || score <= 40) {
    return {
      shell: "border-amber-200 bg-amber-50/80",
      badge: "border-amber-200 bg-white text-amber-700",
      text: "text-amber-900",
      subtext: "text-amber-800/80",
      label: "Slipping",
    }
  }

  return {
    shell: "border-slate-200 bg-slate-50/80",
    badge: "border-slate-200 bg-white text-slate-600",
    text: "text-slate-900",
    subtext: "text-slate-600",
    label: "Balanced",
  }
}

function buildDriftItems(current: CareerTwinSnapshot | null, previous: CareerTwinSnapshot | null): DriftItem[] {
  if (!current) return []

  if (!previous) {
    return [
      {
        id: "first-snapshot",
        text: "First Twin snapshot captured. Apex is starting to calibrate around your real search behavior.",
        tone: "neutral",
      },
    ]
  }

  const items: DriftItem[] = []
  const currentRole = roleLabel(current)
  const previousRole = roleLabel(previous)
  const currentSector = sectorLabel(current)
  const previousSector = sectorLabel(previous)

  if (currentRole && previousRole && currentRole !== previousRole) {
    items.push({
      id: "role-shift",
      text: `Primary lane shifted from ${previousRole} to ${currentRole}.`,
      tone: "neutral",
    })
  }

  if (currentSector && previousSector && currentSector !== previousSector) {
    items.push({
      id: "sector-shift",
      text: `Sector read moved from ${previousSector} to ${currentSector}.`,
      tone: "neutral",
    })
  }

  const previousDimensions = new Map(previous.dimensions.map((dimension) => [dimension.key, dimension]))
  const dimensionDrift = current.dimensions
    .map((dimension) => {
      const previousDimension = previousDimensions.get(dimension.key)
      if (!previousDimension) return null

      const delta = dimension.score - previousDimension.score
      if (Math.abs(delta) < 8) return null

      let text = `${dimension.label} moved ${delta > 0 ? "up" : "down"} by ${Math.abs(delta)} points.`
      let tone: DriftTone = "neutral"

      if (dimension.direction === "strength") {
        tone = delta > 0 ? "positive" : "warning"
        text = `${dimension.label} ${delta > 0 ? "strengthened" : "softened"} by ${Math.abs(delta)} points.`
      } else if (dimension.direction === "risk") {
        tone = delta > 0 ? "warning" : "positive"
        text = `${dimension.label} ${delta > 0 ? "rose" : "eased"} by ${Math.abs(delta)} points.`
      } else if (dimension.direction === "constraint") {
        tone = delta > 0 ? "warning" : "positive"
        text = `${dimension.label} ${delta > 0 ? "tightened" : "eased"} by ${Math.abs(delta)} points.`
      }

      return {
        id: dimension.key,
        delta: Math.abs(delta),
        text,
        tone,
      }
    })
    .filter((item): item is DriftItem & { delta: number } => item !== null)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 2)
    .map(({ delta: _delta, ...item }) => item)

  items.push(...dimensionDrift)

  if (items.length === 0) {
    items.push({
      id: "stable",
      text: "Twin signals are stable since the previous snapshot. Apex sees a consistent search profile right now.",
      tone: "positive",
    })
  }

  return items.slice(0, 3)
}

export function ApexCareerTwinCard({
  twin,
  history = [],
  isLoading = false,
  isRefreshing = false,
  error = null,
  onRefresh,
  onRunFocus,
  variant = "compact",
}: Props) {
  const isSummary = variant === "summary"
  const isCompact = variant === "compact"
  const previousTwin = useMemo(() => {
    if (!twin) return null
    return history.find((snapshot) => snapshot.id !== twin.id) ?? null
  }, [history, twin])

  const driftItems = useMemo(() => buildDriftItems(twin, previousTwin), [twin, previousTwin])
  const recommendedFocus = twin?.recommendedFocus.slice(0, isCompact ? 1 : 2) ?? []
  const strengths = twin?.strengths.slice(0, isCompact ? 2 : 3) ?? []
  const risks = [...(twin?.risks ?? []), ...(twin?.constraints ?? [])].slice(0, isCompact ? 2 : 3)
  const workModes = twin?.preferredWorkModes ?? []
  const executionDimension = getDimension(twin, "execution_follow_through_score")
  const executionTone = executionDimension ? executionToneClasses(executionDimension.direction, executionDimension.score) : null

  const shellClass = isSummary
    ? "space-y-4 rounded-[24px] border border-slate-200 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)] sm:px-6"
    : isCompact
    ? "space-y-3 rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
    : "space-y-4 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_14px_38px_rgba(15,23,42,0.08)] sm:px-6 sm:py-6"

  if (isLoading) {
    return (
      <div className={shellClass}>
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          <p className={`${isCompact ? "text-xs" : "text-sm"} font-medium`}>Loading Twin snapshot…</p>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-5/6 animate-pulse rounded-full bg-slate-100" />
          <div className="h-3 w-full animate-pulse rounded-full bg-slate-100" />
          <div className="h-3 w-4/6 animate-pulse rounded-full bg-slate-100" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`${shellClass} border-red-200 bg-red-50/80 text-red-700`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p className="font-semibold">Career Twin unavailable</p>
            <p className="mt-0.5 text-xs leading-5 text-red-600">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  if (!twin) {
    return (
      <div className={shellClass}>
        <p className="text-xs leading-5 text-slate-500">Apex has not built a Twin snapshot yet.</p>
      </div>
    )
  }

  if (isSummary) {
    return (
      <div className={shellClass}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
              <Brain className="h-3 w-3" />
              Career Twin
            </div>
            <p className="mt-2.5 text-[18px] font-semibold leading-6 tracking-tight text-slate-950">
              {twin.headline}
            </p>
            <p className="mt-1.5 text-sm leading-6 text-slate-500">{twin.summary}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-orange-50">
              <Sparkles className="h-4 w-4 text-orange-600" />
            </div>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 transition hover:opacity-70 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-semibold text-orange-700">
            Confidence {twin.confidence}
          </span>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700">
            Freshness {twin.freshnessScore}
          </span>
          {executionDimension && (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
              Execution {executionDimension.score}
            </span>
          )}
        </div>

        {(roleLabel(twin) || sectorLabel(twin) || workModes.length > 0) && (
          <div>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Current Read</p>
            <div className="flex flex-wrap gap-1.5">
              {roleLabel(twin) && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                  {roleLabel(twin)}
                </span>
              )}
              {sectorLabel(twin) && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                  {sectorLabel(twin)}
                </span>
              )}
              {workModes.slice(0, 2).map((mode) => (
                <span
                  key={mode}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold capitalize text-slate-500"
                >
                  {mode}
                </span>
              ))}
            </div>
          </div>
        )}

        {recommendedFocus[0] && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50/80 px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Recommended Focus</p>
            <p className="mt-1.5 text-[13px] leading-6 text-blue-900">{recommendedFocus[0]}</p>
            {onRunFocus && (
              <button
                type="button"
                onClick={() => onRunFocus(recommendedFocus[0])}
                className="mt-3 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                Run with Apex
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={shellClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
            <Brain className="h-3 w-3" />
            Career Twin
          </div>
          <p className={`${isCompact ? "mt-2 text-[13px]" : "mt-2.5 text-[15px]"} font-bold leading-5 text-slate-900`}>
            {twin.headline}
          </p>
          <p className={`${isCompact ? "mt-1 text-[11px]" : "mt-1.5 text-sm"} leading-5 text-slate-500`}>
            {twin.summary}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className={`inline-flex h-8 w-8 items-center justify-center rounded-xl ${isCompact ? "bg-orange-50" : "bg-orange-100"}`}>
            <Sparkles className="h-4 w-4 text-orange-600" />
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 transition hover:opacity-70 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          )}
        </div>
      </div>

      <div className={isCompact ? "grid gap-3" : "grid gap-4 sm:grid-cols-2"}>
        <MetricBar label="Confidence" value={twin.confidence} tone="orange" />
        <MetricBar label="Freshness" value={twin.freshnessScore} tone="blue" />
      </div>

      {!isCompact && executionDimension && executionTone && (
        <div className={`rounded-2xl border px-4 py-4 ${executionTone.shell}`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Execution Read</p>
              <div className="flex items-center gap-2">
                <p className={`text-[15px] font-semibold ${executionTone.text}`}>{executionDimension.label}</p>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${executionTone.badge}`}>
                  {executionTone.label}
                </span>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-[22px] font-semibold tracking-tight ${executionTone.text}`}>{executionDimension.score}</p>
              <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${executionTone.subtext}`}>
                Confidence {executionDimension.confidence}
              </p>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/70">
            <div
              className={executionDimension.direction === "strength" ? "h-full rounded-full bg-emerald-500" : executionDimension.direction === "risk" ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-slate-400"}
              style={{ width: `${executionDimension.score}%` }}
            />
          </div>
          <div className="mt-3 space-y-1.5">
            {executionDimension.evidence.slice(0, 2).map((item) => (
              <p key={item} className={`text-[11px] leading-5 ${executionTone.subtext}`}>
                {item}
              </p>
            ))}
          </div>
        </div>
      )}

      {(roleLabel(twin) || sectorLabel(twin) || workModes.length > 0) && (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Current Read</p>
          <div className="flex flex-wrap gap-1.5">
            {roleLabel(twin) && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                {roleLabel(twin)}
              </span>
            )}
            {sectorLabel(twin) && (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-700">
                {sectorLabel(twin)}
              </span>
            )}
            {workModes.map((mode) => (
              <span
                key={mode}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold capitalize text-slate-500"
              >
                {mode}
              </span>
            ))}
          </div>
        </div>
      )}

      {recommendedFocus.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Recommended Focus</p>
          <div className="space-y-2">
            {recommendedFocus.map((item) => (
              <div key={item} className="rounded-xl border border-blue-100 bg-blue-50/80 px-3 py-2 text-[11px] leading-5 text-blue-800">
                <p>{item}</p>
                {!isCompact && onRunFocus && (
                  <button
                    type="button"
                    onClick={() => onRunFocus(item)}
                    className="mt-2 inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-100"
                  >
                    Run with Apex
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={isCompact ? "space-y-3" : "grid gap-4 lg:grid-cols-2"}>
        {strengths.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              <TrendingUp className="h-3 w-3 text-emerald-500" />
              Strengths
            </p>
            <div className="space-y-2">
              {strengths.map((item) => (
                <div key={item} className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-[11px] leading-5 text-emerald-800">
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {risks.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              <ShieldAlert className="h-3 w-3 text-amber-500" />
              Risks
            </p>
            <div className="space-y-2">
              {risks.map((item) => (
                <div key={item} className="rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2 text-[11px] leading-5 text-amber-800">
                  {item}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Drift</p>
        <div className="space-y-2">
          {driftItems.map((item) => {
            const toneIcon =
              item.tone === "positive" ? (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
              ) : item.tone === "warning" ? (
                <TrendingDown className="h-3.5 w-3.5 text-amber-600" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-slate-400" />
              )

            const toneClass =
              item.tone === "positive"
                ? "border-emerald-100 bg-emerald-50/70 text-emerald-800"
                : item.tone === "warning"
                  ? "border-amber-100 bg-amber-50/80 text-amber-800"
                  : "border-slate-200 bg-slate-50 text-slate-600"

            return (
              <div key={item.id} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-[11px] leading-5 ${toneClass}`}>
                <span className="mt-0.5 flex-shrink-0">{toneIcon}</span>
                <span>{item.text}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
