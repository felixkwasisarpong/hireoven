"use client"

import { useEffect, useRef, useState } from "react"
import {
  Award,
  Building2,
  ExternalLink,
  FileEdit,
  MapPin,
  Sparkles,
  AlertTriangle,
  ArrowRight,
} from "lucide-react"
import type {
  ScoutCompareItem,
  ScoutCompareResponse,
  ScoutCompareRecommendation,
} from "@/lib/scout/types"
import { useScoutActionExecutor } from "./useScoutActionExecutor"

// ── Config ───────────────────────────────────────────────────────────────────

type RecCfg = {
  label: string
  badgeCls: string
  borderCls: string          // left accent for secondary cards
  scoreCls: string           // score number colour
  barCls: string             // bar fill colour
  ringStroke: string         // SVG arc colour (featured card)
  ringTrack: string          // SVG track colour
}

const REC: Record<ScoutCompareRecommendation, RecCfg> = {
  Best: {
    label: "Best match",
    badgeCls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    borderCls: "border-l-emerald-400",
    scoreCls: "text-emerald-600",
    barCls: "bg-emerald-500",
    ringStroke: "#10b981",
    ringTrack: "rgba(16,185,129,0.15)",
  },
  Good: {
    label: "Good fit",
    badgeCls: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
    borderCls: "border-l-blue-400",
    scoreCls: "text-blue-600",
    barCls: "bg-blue-500",
    ringStroke: "#3b82f6",
    ringTrack: "rgba(59,130,246,0.15)",
  },
  Risky: {
    label: "Risky",
    badgeCls: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    borderCls: "border-l-amber-400",
    scoreCls: "text-amber-600",
    barCls: "bg-amber-500",
    ringStroke: "#f59e0b",
    ringTrack: "rgba(245,158,11,0.15)",
  },
  Skip: {
    label: "Skip",
    badgeCls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    borderCls: "border-l-rose-400",
    scoreCls: "text-rose-500",
    barCls: "bg-rose-400",
    ringStroke: "#f43f5e",
    ringTrack: "rgba(244,63,94,0.12)",
  },
}

const DEFAULT_REC: RecCfg = {
  label: "Reviewed",
  badgeCls: "bg-slate-50 text-slate-600 ring-1 ring-slate-200",
  borderCls: "border-l-slate-300",
  scoreCls: "text-slate-600",
  barCls: "bg-slate-400",
  ringStroke: "#64748b",
  ringTrack: "rgba(100,116,139,0.15)",
}

function scoreColor(score: number): RecCfg["scoreCls"] {
  if (score >= 70) return "text-emerald-600"
  if (score >= 50) return "text-blue-600"
  if (score >= 35) return "text-amber-600"
  return "text-rose-500"
}
function scoreBarCls(score: number): RecCfg["barCls"] {
  if (score >= 70) return "bg-emerald-500"
  if (score >= 50) return "bg-blue-500"
  if (score >= 35) return "bg-amber-500"
  return "bg-rose-400"
}
function scoreRingStroke(score: number): string {
  if (score >= 70) return "#10b981"
  if (score >= 50) return "#3b82f6"
  if (score >= 35) return "#f59e0b"
  return "#f43f5e"
}

// ── SVG score ring (featured card) ──────────────────────────────────────────

function ScoreRing({ score, delay = 0 }: { score: number; delay?: number }) {
  const r = 30
  const circ = 2 * Math.PI * r
  const [offset, setOffset] = useState(circ)
  useEffect(() => {
    const id = window.setTimeout(() => setOffset(circ * (1 - score / 100)), 120 + delay)
    return () => window.clearTimeout(id)
  }, [score, circ, delay])

  const stroke = scoreRingStroke(score)

  return (
    <div className="relative flex items-center justify-center">
      <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] -rotate-90">
        {/* track */}
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="6" />
        {/* fill */}
        <circle
          cx="36" cy="36" r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <span className="absolute text-[15px] font-bold leading-none text-white">
        {score}
        <span className="text-[9px] font-semibold text-white/60">%</span>
      </span>
    </div>
  )
}

// ── Thin animated bar (secondary cards) ────────────────────────────────────

function ScoreBar({ score, delay = 0 }: { score: number; delay?: number }) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const id = window.setTimeout(() => setWidth(Math.min(100, score)), 100 + delay)
    return () => window.clearTimeout(id)
  }, [score, delay])

  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full ${scoreBarCls(score)} transition-[width] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]`}
        style={{ width: `${width}%` }}
      />
    </div>
  )
}

// ── Action executor hook shim ────────────────────────────────────────────────

function useCardActions(item: ScoutCompareItem, resumeId?: string) {
  const { executeAction, feedback } = useScoutActionExecutor()
  const [opening, setOpening] = useState<"job" | "company" | "tailor" | null>(null)

  function open(type: "job" | "company" | "tailor") {
    if (opening) return
    setOpening(type)
    if (type === "job") {
      executeAction(
        { type: "OPEN_JOB", payload: { jobId: item.jobId }, label: item.title },
        { source: "chat", onExecuted: () => setOpening(null) }
      )
    } else if (type === "company" && item.companyId) {
      executeAction(
        { type: "OPEN_COMPANY", payload: { companyId: item.companyId }, label: item.company ?? "Company" },
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

  return { open, opening, feedback }
}

// ── Featured card (winner — full width, split layout) ───────────────────────

function FeaturedCard({
  item,
  resumeId,
  index,
}: {
  item: ScoutCompareItem
  resumeId?: string
  index: number
}) {
  const cfg = item.recommendation ? REC[item.recommendation] : DEFAULT_REC
  const { open, opening, feedback } = useCardActions(item, resumeId)
  const hasScore = item.matchScore !== null && item.matchScore !== undefined

  return (
    <article
      className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_4px_24px_-8px_rgba(15,23,42,0.14)] opacity-0 animate-[scout-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_forwards] transition-shadow duration-300 hover:shadow-[0_12px_36px_-12px_rgba(15,23,42,0.20)]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex min-h-[130px] flex-col sm:flex-row">

        {/* Dark score panel */}
        {hasScore && (
          <div className="relative flex min-w-[110px] flex-col items-center justify-center gap-1.5 overflow-hidden bg-slate-950 px-5 py-5 sm:px-6">
            {/* Subtle radial glow behind ring */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(circle at center, ${scoreRingStroke(item.matchScore!)}22 0%, transparent 70%)`,
              }}
            />
            <ScoreRing score={item.matchScore!} delay={index * 60} />
            <p className="relative text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              match
            </p>
          </div>
        )}

        {/* Content */}
        <div className="flex flex-1 flex-col justify-between gap-3 px-5 py-4 sm:px-6 sm:py-5">
          <div>
            {/* Badges row */}
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              {item.recommendation && (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badgeCls}`}>
                  {cfg.label}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                <Award className="h-3 w-3" />
                Top pick
              </span>
            </div>

            <h3 className="text-[15px] font-bold leading-snug tracking-tight text-slate-900">
              {item.title}
            </h3>
            {item.company && (
              <p className="mt-0.5 text-[13px] font-medium text-slate-500">{item.company}</p>
            )}

            {/* Meta */}
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
              {item.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3 text-slate-400" />
                  {item.location}
                </span>
              )}
              {item.salaryRange && (
                <span className="font-semibold text-slate-800">{item.salaryRange}</span>
              )}
              {item.sponsorshipSignal && (
                <span className="inline-flex items-center gap-1 text-orange-600">
                  <Sparkles className="h-3 w-3" />
                  {item.sponsorshipSignal}
                </span>
              )}
            </div>

            {item.riskSummary && (
              <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0 text-amber-600" />
                <span className="text-xs text-amber-800">{item.riskSummary}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button" onClick={() => open("job")} disabled={!!opening}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View job
            </button>
            {item.companyId && (
              <button
                type="button" onClick={() => open("company")} disabled={!!opening}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                <Building2 className="h-3.5 w-3.5" />
                Company
              </button>
            )}
            <button
              type="button" onClick={() => open("tailor")} disabled={!!opening}
              className="inline-flex items-center gap-1 rounded-md bg-[#FF5C18] px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_4px_12px_-4px_rgba(255,92,24,0.50)] transition hover:bg-[#E14F0E] disabled:opacity-50"
            >
              <FileEdit className="h-3.5 w-3.5" />
              Tailor resume
            </button>
            {feedback && !opening && (
              <span className="text-[11px] text-slate-400">{feedback}</span>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

// ── Secondary card (compact 2-col grid) ─────────────────────────────────────

function SecondaryCard({
  item,
  rank,
  resumeId,
  index,
}: {
  item: ScoutCompareItem
  rank: number
  resumeId?: string
  index: number
}) {
  const cfg = item.recommendation ? REC[item.recommendation] : DEFAULT_REC
  const { open, opening, feedback } = useCardActions(item, resumeId)
  const hasScore = item.matchScore !== null && item.matchScore !== undefined

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl border-l-[3px] border border-slate-200/80 bg-white shadow-[0_2px_12px_-6px_rgba(15,23,42,0.10)] ${cfg.borderCls} opacity-0 animate-[scout-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_forwards] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_-10px_rgba(15,23,42,0.16)]`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex-1 px-4 pt-4 pb-3">
        {/* Top: rank + badge + score */}
        <div className="mb-2.5 flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold tracking-wide text-slate-400">
              #{rank}
            </span>
            {item.recommendation && (
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badgeCls}`}>
                {cfg.label}
              </span>
            )}
          </div>
          {hasScore && (
            <span className={`text-[22px] font-black leading-none tabular-nums ${scoreColor(item.matchScore!)}`}>
              {item.matchScore}
              <span className="text-[11px] font-bold">%</span>
            </span>
          )}
        </div>

        {/* Title + company */}
        <h3 className="text-[14px] font-semibold leading-snug tracking-tight text-slate-900">
          {item.title}
        </h3>
        {item.company && (
          <p className="mt-0.5 text-[12px] font-medium text-slate-500">{item.company}</p>
        )}

        {/* Score bar */}
        {hasScore && (
          <div className="mt-3">
            <ScoreBar score={item.matchScore!} delay={index * 60} />
          </div>
        )}

        {/* Meta */}
        {(item.location || item.salaryRange) && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            {item.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3 text-slate-400" />
                {item.location}
              </span>
            )}
            {item.location && item.salaryRange && <span className="text-slate-300">·</span>}
            {item.salaryRange && <span className="font-semibold text-slate-700">{item.salaryRange}</span>}
          </div>
        )}

        {/* Risk */}
        {item.riskSummary && (
          <div className="mt-2 flex items-start gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5">
            <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0 text-amber-600" />
            <span className="text-[11px] leading-4 text-amber-800">{item.riskSummary}</span>
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-1 border-t border-slate-100 px-4 py-2.5">
        <button
          type="button" onClick={() => open("job")} disabled={!!opening}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          <ExternalLink className="h-3 w-3" />
          View job
        </button>
        {item.companyId && (
          <button
            type="button" onClick={() => open("company")} disabled={!!opening}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
          >
            <Building2 className="h-3 w-3" />
            Company
          </button>
        )}
        {feedback && !opening && (
          <span className="text-[11px] text-slate-400">{feedback}</span>
        )}
      </div>
    </article>
  )
}

// ── Main renderer ─────────────────────────────────────────────────────────────

type ScoutCompareRendererProps = {
  compare: ScoutCompareResponse
  resumeId?: string
}

export function ScoutCompareRenderer({ compare, resumeId }: ScoutCompareRendererProps) {
  const { items, summary, winnerJobId, tradeoffs } = compare
  if (items.length < 2) return null

  // Sort: winner first, then by matchScore desc
  const sorted = [...items].sort((a, b) => {
    if (winnerJobId) {
      if (a.jobId === winnerJobId) return -1
      if (b.jobId === winnerJobId) return 1
    }
    return (b.matchScore ?? 0) - (a.matchScore ?? 0)
  })

  const [featured, ...rest] = sorted

  return (
    <div className="space-y-3">
      {/* Summary */}
      {summary && (
        <p className="text-sm leading-6 text-slate-600 opacity-0 animate-[scout-card-in_0.4s_cubic-bezier(0.22,1,0.36,1)_forwards]">
          {summary}
        </p>
      )}

      {/* Featured winner */}
      <FeaturedCard item={featured} resumeId={resumeId} index={0} />

      {/* Secondary grid — mobile swipe */}
      {rest.length > 0 && (
        <>
          <div className="-mx-0.5 md:hidden">
            <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1">
              {rest.map((item, i) => (
                <SecondaryCard
                  key={item.jobId}
                  item={item}
                  rank={i + 2}
                  resumeId={resumeId}
                  index={i + 1}
                  // @ts-ignore className injection for snap
                  className="min-w-[84%] snap-start"
                />
              ))}
            </div>
          </div>

          {/* Desktop grid */}
          <div className={`hidden gap-3 md:grid ${rest.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
            {rest.map((item, i) => (
              <SecondaryCard
                key={item.jobId}
                item={item}
                rank={i + 2}
                resumeId={resumeId}
                index={i + 1}
              />
            ))}
          </div>
        </>
      )}

      {/* Tradeoffs */}
      {tradeoffs && tradeoffs.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3.5 opacity-0 animate-[scout-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_forwards] [animation-delay:360ms]">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            Key tradeoffs
          </p>
          <ul className="space-y-1.5">
            {tradeoffs.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-xs leading-5 text-slate-600">
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
