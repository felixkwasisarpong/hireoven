"use client"

import { useEffect } from "react"
import Link from "next/link"
import { ArrowRight, Check, ExternalLink, Plus, X } from "lucide-react"
import AnalysisScoreCircle from "@/components/resume/AnalysisScoreCircle"
import { useResumeAnalysis } from "@/lib/hooks/useResumeAnalysis"
import { cn } from "@/lib/utils"
import type { ApplyRecommendation, ResumeAnalysis } from "@/types"

type Props = {
  resumeId: string
  jobId: string
  jobTitle: string
  applyUrl: string
  onClose: () => void
  autoAnalyze?: boolean
}

const VERDICT_LABEL: Record<string, string> = {
  strong_match: "Strong match",
  good_match:   "Good match",
  partial_match:"Partial match",
  weak_match:   "Weak match",
}

const APPLY_CONFIG: Record<ApplyRecommendation, { label: string; bg: string; text: string; ring: string }> = {
  apply_now:         { label: "Strong fit — apply now",           bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
  apply_with_tweaks: { label: "Apply after a few tweaks",         bg: "bg-amber-50",   text: "text-amber-700",  ring: "ring-amber-200"   },
  stretch_role:      { label: "Stretch role — apply if confident",bg: "bg-amber-50",   text: "text-amber-700",  ring: "ring-amber-200"   },
  skip:              { label: "Significant gaps — consider skip", bg: "bg-red-50",     text: "text-red-700",    ring: "ring-red-200"     },
}

const SCORE_TILES = [
  { label: "Skills",    key: "skills_score"    },
  { label: "Exp",       key: "experience_score"},
  { label: "Education", key: "education_score" },
  { label: "Keywords",  key: "keywords_score"  },
] as const

function tileColor(v: number): { num: string; bar: string } {
  if (v >= 70) return { num: "text-emerald-600", bar: "bg-emerald-400" }
  if (v >= 45) return { num: "text-orange-500",  bar: "bg-orange-400"  }
  return           { num: "text-red-500",     bar: "bg-red-400"     }
}

// ─── Content ──────────────────────────────────────────────────────────────────

function DrawerContent({
  analysis,
  jobId,
  applyUrl,
}: {
  analysis: ResumeAnalysis
  jobId: string
  applyUrl: string
}) {
  const applyConfig        = analysis.apply_recommendation ? APPLY_CONFIG[analysis.apply_recommendation] : null
  const topMissingSkills   = (analysis.missing_skills  ?? []).slice(0, 4)
  const topMatchingSkills  = (analysis.matching_skills ?? []).slice(0, 4)
  const topMissingKeywords = (analysis.missing_keywords ?? []).slice(0, 5)
  const hasSkills          = topMissingSkills.length > 0 || topMatchingSkills.length > 0

  return (
    <div className="divide-y divide-slate-100">

      {/* ── Score hero ───────────────────────────────────────────── */}
      <div className="flex flex-col items-center px-6 pb-6 pt-7 text-center">
        <AnalysisScoreCircle score={analysis.overall_score ?? 0} size="lg" animated />

        <h2 className="mt-4 text-[20px] font-bold tracking-tight text-slate-900">
          {VERDICT_LABEL[analysis.verdict ?? "partial_match"]}
        </h2>

        {applyConfig && (
          <span className={cn(
            "mt-2 inline-block rounded-full px-3 py-1 text-[12px] font-semibold ring-1",
            applyConfig.bg, applyConfig.text, applyConfig.ring
          )}>
            {applyConfig.label}
          </span>
        )}

        {analysis.verdict_summary && (
          <p className="mt-3 text-[13px] leading-[1.7] text-slate-500 line-clamp-3">
            {analysis.verdict_summary}
          </p>
        )}
      </div>

      {/* ── Score tiles ──────────────────────────────────────────── */}
      <div className="px-5 py-5">
        <div className="grid grid-cols-4 gap-2">
          {SCORE_TILES.map(({ label, key }) => {
            const v = Math.max(0, Math.min(100, Math.round(analysis[key] ?? 0)))
            const { num, bar } = tileColor(v)
            return (
              <div key={label} className="flex flex-col items-center rounded-xl bg-slate-50 px-2 py-3 ring-1 ring-slate-100">
                <span className={cn("text-[20px] font-bold tabular-nums leading-none", num)}>{v}</span>
                <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className={cn("h-full rounded-full transition-[width] duration-700", bar)} style={{ width: `${v}%` }} />
                </div>
                <span className="mt-1.5 text-[10px] font-medium text-slate-400">{label}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Skills ───────────────────────────────────────────────── */}
      {hasSkills && (
        <div className="px-5 py-5">
          <div className="grid grid-cols-2 gap-4">

            {topMissingSkills.length > 0 && (
              <div>
                <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Missing
                </p>
                <div className="flex flex-col gap-1.5">
                  {topMissingSkills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[11.5px] font-medium text-orange-600 ring-1 ring-orange-200/60"
                    >
                      <Plus className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{skill}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {topMatchingSkills.length > 0 && (
              <div>
                <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  You have
                </p>
                <div className="flex flex-col gap-1.5">
                  {topMatchingSkills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11.5px] font-medium text-emerald-700 ring-1 ring-emerald-200/60"
                    >
                      <Check className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{skill}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── Missing ATS keywords ─────────────────────────────────── */}
      {topMissingKeywords.length > 0 && (
        <div className="px-5 py-5">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Missing ATS keywords
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topMissingKeywords.map((kw) => (
              <span
                key={kw}
                className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11.5px] font-medium text-slate-600"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────── */}
      <div className="px-5 pb-6 pt-5 space-y-2">
        <Link
          href={`/dashboard/resume/analyze/${jobId}`}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-3 text-[13px] font-bold text-white shadow-sm transition hover:bg-orange-400 active:scale-[0.98]"
        >
          View full analysis
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        <a
          href={applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-[13px] font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
        >
          Apply directly
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    </div>
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DrawerLoading({ isAnalyzing }: { isAnalyzing: boolean }) {
  return (
    <div className="divide-y divide-slate-100">
      {/* Score hero skeleton */}
      <div className="flex flex-col items-center px-6 pb-6 pt-7">
        <div className="relative h-[96px] w-[96px]">
          <div className="absolute inset-0 animate-spin rounded-full border-[8px] border-slate-100 border-t-orange-400" />
        </div>
        <div className="mt-4 h-5 w-32 animate-pulse rounded-lg bg-slate-100" />
        <div className="mt-2 h-4 w-44 animate-pulse rounded-full bg-slate-100" />
        <div className="mt-3 space-y-1.5 w-full max-w-[240px]">
          <div className="h-3 animate-pulse rounded bg-slate-100" />
          <div className="h-3 animate-pulse rounded bg-slate-100 w-4/5 mx-auto" />
        </div>
        <p className="mt-4 text-[12px] text-slate-400">
          {isAnalyzing ? "Analyzing your fit…" : "Loading…"}
        </p>
      </div>

      {/* Score tiles skeleton */}
      <div className="px-5 py-5">
        <div className="grid grid-cols-4 gap-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex flex-col items-center rounded-xl bg-slate-50 px-2 py-3 ring-1 ring-slate-100">
              <div className="h-5 w-6 animate-pulse rounded bg-slate-200" />
              <div className="mt-2 h-1 w-full rounded-full bg-slate-200 animate-pulse" />
              <div className="mt-1.5 h-2.5 w-8 animate-pulse rounded bg-slate-200" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function QuickAnalysisDrawer({
  resumeId,
  jobId,
  jobTitle,
  applyUrl,
  onClose,
  autoAnalyze = false,
}: Props) {
  const { analysis, isLoading, isAnalyzing, error, triggerAnalysis } = useResumeAnalysis(resumeId, jobId)

  useEffect(() => {
    if (!autoAnalyze) return
    if (!isLoading && !analysis && !isAnalyzing && !error) void triggerAnalysis()
  }, [autoAnalyze, isLoading, analysis, isAnalyzing, error, triggerAnalysis])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const busy = isLoading || isAnalyzing

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" onClick={onClose} aria-hidden />

      <div className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[360px] flex-col overflow-hidden bg-white shadow-2xl sm:bottom-auto sm:rounded-l-2xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-500">Match analysis</p>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-slate-800">{jobTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-4 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {busy && <DrawerLoading isAnalyzing={isAnalyzing} />}

          {!busy && error && (
            <div className="m-5 rounded-2xl border border-red-100 bg-red-50 p-5">
              <p className="text-[13px] font-semibold text-red-700">Analysis failed</p>
              <p className="mt-1 text-[12.5px] text-red-500">{error}</p>
              <button
                type="button"
                onClick={() => void triggerAnalysis()}
                className="mt-3 rounded-lg bg-red-100 px-3 py-1.5 text-[12px] font-semibold text-red-700 transition hover:bg-red-200"
              >
                Try again
              </button>
            </div>
          )}

          {!busy && !error && !analysis && (
            <div className="flex flex-col items-center gap-4 px-5 py-16 text-center">
              <p className="text-[13px] text-slate-500">No analysis cached for this job.</p>
              <button
                type="button"
                onClick={() => void triggerAnalysis()}
                className="rounded-xl bg-orange-500 px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-orange-400"
              >
                Analyze now
              </button>
            </div>
          )}

          {!busy && !error && analysis && (
            <DrawerContent analysis={analysis} jobId={jobId} applyUrl={applyUrl} />
          )}
        </div>
      </div>
    </>
  )
}
