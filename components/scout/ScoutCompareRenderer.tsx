"use client"

import { useState } from "react"
import {
  ArrowRight,
  Award,
  Building2,
  ExternalLink,
  FileEdit,
  MapPin,
  Sparkles,
  AlertTriangle,
} from "lucide-react"
import type { ScoutCompareItem, ScoutCompareResponse, ScoutCompareRecommendation } from "@/lib/scout/types"
import { useScoutActionExecutor } from "./useScoutActionExecutor"

// ── Recommendation config ────────────────────────────────────────────────────

const REC_CONFIG: Record<
  ScoutCompareRecommendation,
  {
    label: string
    border: string
    bg: string
    badge: string
    accent: string
    header: string
  }
> = {
  Best: {
    label: "Best match",
    border: "border-emerald-200",
    bg: "bg-white",
    badge: "bg-emerald-100 text-emerald-800 border-emerald-300",
    accent: "bg-emerald-500",
    header: "bg-emerald-50",
  },
  Good: {
    label: "Good fit",
    border: "border-blue-200",
    bg: "bg-white",
    badge: "bg-blue-100 text-blue-800 border-blue-300",
    accent: "bg-blue-500",
    header: "bg-blue-50",
  },
  Risky: {
    label: "Risky",
    border: "border-amber-200",
    bg: "bg-white",
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    accent: "bg-amber-400",
    header: "bg-amber-50",
  },
  Skip: {
    label: "Skip",
    border: "border-rose-200",
    bg: "bg-white",
    badge: "bg-rose-100 text-rose-800 border-rose-300",
    accent: "bg-rose-400",
    header: "bg-rose-50",
  },
}

const DEFAULT_CONFIG = REC_CONFIG.Good

// ── Match score bar ──────────────────────────────────────────────────────────

function MatchBar({ score }: { score: number }) {
  const color =
    score >= 70 ? "bg-emerald-500" : score >= 50 ? "bg-blue-500" : score >= 35 ? "bg-amber-400" : "bg-rose-400"
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(100, score)}%` }}
        />
      </div>
      <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-600">
        {score}%
      </span>
    </div>
  )
}

// ── Compare card ─────────────────────────────────────────────────────────────

function CompareCard({
  item,
  isWinner,
  resumeId,
  className,
}: {
  item: ScoutCompareItem
  isWinner: boolean
  resumeId?: string
  className?: string
}) {
  const cfg = item.recommendation ? REC_CONFIG[item.recommendation] : DEFAULT_CONFIG
  const { executeAction, feedback } = useScoutActionExecutor()
  const [opening, setOpening] = useState<"job" | "company" | "tailor" | null>(null)

  function handleOpen(type: "job" | "company" | "tailor") {
    if (opening) return
    setOpening(type)
    if (type === "job") {
      executeAction(
        { type: "OPEN_JOB", payload: { jobId: item.jobId }, label: `View ${item.title}` },
        { source: "chat", onExecuted: () => setOpening(null) }
      )
    } else if (type === "company" && item.companyId) {
      executeAction(
        { type: "OPEN_COMPANY", payload: { companyId: item.companyId }, label: `View ${item.company ?? "Company"}` },
        { source: "chat", onExecuted: () => setOpening(null) }
      )
    } else if (type === "tailor") {
      executeAction(
        {
          type: "OPEN_RESUME_TAILOR",
          payload: resumeId ? { resumeId, jobId: item.jobId } : { jobId: item.jobId },
          label: "Tailor resume",
        },
        { source: "chat", onExecuted: () => setOpening(null) }
      )
    } else {
      setOpening(null)
    }
  }

  return (
    <article
      className={`relative flex flex-col overflow-hidden rounded-2xl border shadow-[0_2px_12px_rgba(15,23,42,0.06)] transition ${cfg.border} ${cfg.bg} ${className ?? ""}`}
    >
      {/* Accent top bar */}
      <div className={`h-1 w-full ${cfg.accent}`} />

      {/* Winner crown */}
      {isWinner && (
        <div className="absolute right-3 top-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
            <Award className="h-3 w-3" />
            Top pick
          </span>
        </div>
      )}

      {/* Header */}
      <div className={`px-4 pt-4 pb-3 ${cfg.header}`}>
        {item.recommendation && (
          <span
            className={`mb-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cfg.badge}`}
          >
            {cfg.label}
          </span>
        )}
        <h3 className="text-sm font-bold leading-5 text-slate-900 pr-16">{item.title}</h3>
        {item.company && (
          <p className="mt-0.5 text-xs text-slate-500">{item.company}</p>
        )}
      </div>

      {/* Data rows */}
      <div className="flex-1 space-y-2.5 px-4 py-3">
        {/* Match score */}
        {item.matchScore !== null && item.matchScore !== undefined && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Match
            </p>
            <MatchBar score={item.matchScore} />
          </div>
        )}

        {/* Location + salary */}
        <div className="space-y-1.5 text-xs text-slate-600">
          {item.location && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3 w-3 shrink-0 text-slate-400" />
              <span>{item.location}</span>
              {item.salaryRange && (
                <>
                  <span className="text-slate-300">·</span>
                  <span className="font-medium text-slate-700">{item.salaryRange}</span>
                </>
              )}
            </div>
          )}
          {!item.location && item.salaryRange && (
            <p className="font-medium text-slate-700">{item.salaryRange}</p>
          )}
        </div>

        {/* Sponsorship signal */}
        {item.sponsorshipSignal && (
          <div className="flex items-start gap-1.5">
            <Sparkles className="mt-[1px] h-3 w-3 shrink-0 text-orange-500" />
            <span className="text-xs text-slate-600">{item.sponsorshipSignal}</span>
          </div>
        )}

        {/* Risk summary */}
        {item.riskSummary && (
          <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
            <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0 text-amber-600" />
            <span className="text-xs text-amber-800">{item.riskSummary}</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={() => handleOpen("job")}
          disabled={!!opening}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
        >
          <ExternalLink className="h-3 w-3" />
          View job
        </button>

        {item.companyId && (
          <button
            type="button"
            onClick={() => handleOpen("company")}
            disabled={!!opening}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
          >
            <Building2 className="h-3 w-3" />
            Company
          </button>
        )}

        {isWinner && (
          <button
            type="button"
            onClick={() => handleOpen("tailor")}
            disabled={!!opening}
            className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-700 transition hover:bg-orange-100 disabled:opacity-50"
          >
            <FileEdit className="h-3 w-3" />
            Tailor resume
          </button>
        )}

        {feedback && opening === null && (
          <span className="self-center text-[11px] text-slate-400">{feedback}</span>
        )}
      </div>
    </article>
  )
}

// ── Main renderer ─────────────────────────────────────────────────────────────

type ScoutCompareRendererProps = {
  compare: ScoutCompareResponse
  /** Resume ID for the winner's "Tailor resume" shortcut */
  resumeId?: string
}

export function ScoutCompareRenderer({ compare, resumeId }: ScoutCompareRendererProps) {
  const { items, summary, winnerJobId, tradeoffs } = compare
  if (items.length < 2) return null

  const gridCols =
    items.length === 2
      ? "grid-cols-1 sm:grid-cols-2"
      : items.length === 3
      ? "grid-cols-1 sm:grid-cols-3"
      : "grid-cols-1 sm:grid-cols-2"

  return (
    <div className="mt-4 space-y-3">
      {/* Section label */}
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
        Job comparison
      </p>

      {/* Summary */}
      <p className="text-sm leading-6 text-slate-700">{summary}</p>

      {/* Mobile swipe cards */}
      <div className="-mx-1 md:hidden">
        <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
          {items.map((item) => (
            <CompareCard
              key={item.jobId}
              item={item}
              isWinner={!!winnerJobId && item.jobId === winnerJobId}
              resumeId={resumeId}
              className="min-w-[84%] snap-start"
            />
          ))}
        </div>
      </div>

      {/* Desktop grid */}
      <div className={`hidden gap-3 md:grid ${gridCols}`}>
        {items.map((item) => (
          <CompareCard
            key={item.jobId}
            item={item}
            isWinner={!!winnerJobId && item.jobId === winnerJobId}
            resumeId={resumeId}
          />
        ))}
      </div>

      {/* Tradeoffs */}
      {tradeoffs && tradeoffs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Key tradeoffs
          </p>
          <ul className="space-y-1.5">
            {tradeoffs.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
