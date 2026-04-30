"use client"

import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import {
  DIRECTION_CATEGORY_META,
} from "@/lib/scout/career/types"
import type { ScoutCareerDirection, ScoutCareerStrategyResult } from "@/lib/scout/career/types"

// ── Confidence badge ──────────────────────────────────────────────────────────

function confidenceLabel(c: number): { text: string; cls: string } {
  if (c >= 0.75) return { text: "Strong fit",   cls: "text-emerald-700 bg-emerald-50 border-emerald-100" }
  if (c >= 0.58) return { text: "Moderate fit", cls: "text-amber-700   bg-amber-50   border-amber-100"   }
  return               { text: "Early signal", cls: "text-slate-600   bg-slate-50   border-slate-200"   }
}

// ── Direction card ────────────────────────────────────────────────────────────

function DirectionCard({
  direction,
  onCommand,
}: {
  direction: ScoutCareerDirection
  onCommand: (cmd: string) => void
}) {
  const [open, setOpen] = useState(false)
  const meta  = DIRECTION_CATEGORY_META[direction.category]
  const conf  = confidenceLabel(direction.confidence)
  const pct   = Math.round(direction.confidence * 100)

  return (
    <div className={cn("rounded-xl border p-4 transition-all", meta.bg)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className={cn("mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full", meta.dot)} />
          <div className="min-w-0">
            <p className={cn("text-sm font-semibold leading-snug", meta.accent)}>{direction.title}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{DIRECTION_CATEGORY_META[direction.category].label}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", conf.cls)}>
            {conf.text}
          </span>
          {/* Confidence bar */}
          <div className="hidden sm:flex items-center gap-1.5">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/60">
              <div className={cn("h-full rounded-full", meta.dot)} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-slate-400">{pct}%</span>
          </div>
        </div>
      </div>

      {/* Reasons */}
      {direction.reasons && direction.reasons.length > 0 && (
        <div className="mt-2.5 space-y-1">
          {direction.reasons.slice(0, open ? undefined : 2).map((reason, i) => (
            <p key={i} className="flex items-start gap-2 text-[11px] text-slate-600">
              <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
              {reason}
            </p>
          ))}
          {direction.reasons.length > 2 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 transition hover:text-slate-600"
            >
              {open
                ? <><ChevronUp className="h-3 w-3" /> Show less</>
                : <><ChevronDown className="h-3 w-3" /> {direction.reasons.length - 2} more reason{direction.reasons.length - 2 !== 1 ? "s" : ""}</>}
            </button>
          )}
        </div>
      )}

      {/* Suggested skills + roles */}
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {direction.suggestedSkills && direction.suggestedSkills.length > 0 && (
            <div>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Key Skills</p>
              <div className="flex flex-wrap gap-1">
                {direction.suggestedSkills.map((s) => (
                  <span key={s} className="rounded bg-white/70 border border-white/50 px-1.5 py-0.5 text-[10px] text-slate-600">{s}</span>
                ))}
              </div>
            </div>
          )}
          {direction.suggestedRoles && direction.suggestedRoles.length > 0 && (
            <div>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">Target Roles</p>
              <ul className="space-y-0.5">
                {direction.suggestedRoles.slice(0, 3).map((r) => (
                  <li key={r} className="text-[10px] text-slate-600">· {r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onCommand(`Queue jobs matching ${direction.title} direction`)}
          className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
        >
          Queue jobs
          <ArrowRight className="h-3 w-3 text-slate-400" />
        </button>
        {direction.suggestedCompanies && direction.suggestedCompanies.length > 0 && (
          <button
            type="button"
            onClick={() => onCommand(`Research companies for ${direction.title}: ${direction.suggestedCompanies!.slice(0, 2).join(", ")}`)}
            className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
          >
            Research companies
            <ArrowRight className="h-3 w-3 text-slate-400" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  data:      ScoutCareerStrategyResult | null
  loading:   boolean
  error:     string | null
  onCommand: (cmd: string) => void
}

export function CareerStrategyMode({ data, loading, error, onCommand }: Props) {

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-5 py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[#FF5C18]" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Analysing your career profile…</p>
            <p className="mt-0.5 text-xs text-slate-400">Gathering skill patterns, traction signals, and market data</p>
          </div>
        </div>
        {/* Skeleton cards */}
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-xl border border-slate-100 bg-slate-50 h-28" />
        ))}
      </div>
    )
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4">
        <p className="text-sm font-semibold text-red-700">Career analysis failed</p>
        <p className="mt-1 text-xs text-red-500">{error}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {["What direction fits my profile?", "Analyze my best career direction"].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onCommand(chip)}
              className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5">
        <div className="flex items-center gap-2 mb-3">
          <Target className="h-4 w-4 text-[#FF5C18]" />
          <p className="text-sm font-semibold text-slate-900">Career Strategy</p>
        </div>
        <p className="text-sm text-slate-500">
          Ask Scout to analyse your career direction. It uses your skills, applications, and market signals.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[
            "What direction fits my profile best?",
            "Where am I getting the strongest traction?",
            "What skills would unlock stronger opportunities?",
            "Should I focus on platform or AI infra?",
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onCommand(chip)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Full strategy ──────────────────────────────────────────────────────────
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_220px]">

      {/* ── Left: directions + analysis ────────────────────────────────── */}
      <div className="space-y-5">

        {/* Strategic header */}
        <div>
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-[#FF5C18]" />
            <p className="text-sm font-semibold text-slate-900">Career Strategy</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
              {data.directions.length} direction{data.directions.length !== 1 ? "s" : ""}
            </span>
          </div>
          {data.summary && (
            <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{data.summary}</p>
          )}
        </div>

        {/* Direction cards */}
        {data.directions.length > 0 ? (
          <div className="space-y-3">
            {data.directions.map((direction) => (
              <DirectionCard
                key={direction.id}
                direction={direction}
                onCommand={onCommand}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-400">
            Not enough data to surface specific directions yet. Add more saved jobs and resume skills.
          </div>
        )}

        {/* Traction signals */}
        {data.tractionSignals.length > 0 && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Traction Signals</p>
            </div>
            <ul className="space-y-1.5">
              {data.tractionSignals.map((sig, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-emerald-700">
                  <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-emerald-400" />
                  {sig}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Gap signals */}
        {data.gapSignals.length > 0 && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Gap Signals</p>
            </div>
            <ul className="space-y-1.5">
              {data.gapSignals.map((sig, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-700">
                  <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-amber-400" />
                  {sig}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Follow-up chips */}
        <div className="flex flex-wrap gap-2">
          {[
            "Compare these directions",
            "What skills should I prioritize?",
            "Which companies align most?",
            "Generate a skill roadmap",
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onCommand(chip)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: aggregate suggestions ──────────────────────────────── */}
      <div className="hidden space-y-5 lg:block">

        {/* Suggested companies (aggregated across directions) */}
        {(() => {
          const companies = [...new Set(data.directions.flatMap((d) => d.suggestedCompanies ?? []))].slice(0, 6)
          if (!companies.length) return null
          return (
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <Briefcase className="h-3 w-3 text-slate-400" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Top Companies</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {companies.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => onCommand(`Research ${c} — hiring patterns and sponsorship`)}
                    className="rounded-md bg-white border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 shadow-sm transition hover:border-slate-400"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Suggested skills (aggregated) */}
        {(() => {
          const skills = [...new Set(data.directions.flatMap((d) => d.suggestedSkills ?? []))].slice(0, 7)
          if (!skills.length) return null
          return (
            <div className="border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-amber-400" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Key Skills to Add</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {skills.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onCommand(`What jobs would I unlock by adding ${s}?`)}
                    className="rounded-md bg-amber-50 border border-amber-100 px-2 py-1 text-[10px] font-medium text-amber-700 transition hover:bg-amber-100"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )
        })()}

        {/* Scout guidance note */}
        <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3">
          <div className="mb-1 flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-[#FF5C18]/70" />
            <p className="text-[10px] font-semibold text-slate-400">About this analysis</p>
          </div>
          <p className="text-[10px] leading-4 text-slate-400">
            Directions are derived from your skills, application traction, and market patterns.
            Confidence reflects data quality — not guaranteed outcomes.
          </p>
        </div>
      </div>
    </div>
  )
}
