"use client"

import { useEffect } from "react"
import Link from "next/link"
import { ExternalLink, Loader2, X, XCircle } from "lucide-react"
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
  good_match: "Good match",
  partial_match: "Partial match",
  weak_match: "Weak match",
}

const APPLY_CONFIG: Record<
  ApplyRecommendation,
  { label: string; className: string }
> = {
  apply_now: {
    label: "Apply now - you're a strong fit",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  apply_with_tweaks: {
    label: "Apply after updating your resume",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  stretch_role: {
    label: "Stretch role - apply if confident",
    className: "border-amber-200 bg-amber-50 text-amber-800",
  },
  skip: {
    label: "Significant gaps - consider skipping",
    className: "border-red-200 bg-red-50 text-red-800",
  },
}

function DrawerContent({
  analysis,
  jobId,
  applyUrl,
}: {
  analysis: ResumeAnalysis
  jobId: string
  applyUrl: string
}) {
  const applyConfig = analysis.apply_recommendation
    ? APPLY_CONFIG[analysis.apply_recommendation]
    : null
  const topMissingSkills = (analysis.missing_skills ?? []).slice(0, 3)
  const topMissingKeywords = (analysis.missing_keywords ?? []).slice(0, 3)

  return (
    <div className="flex flex-col gap-5">
      {/* Score + verdict */}
      <div className="flex items-center gap-5">
        <AnalysisScoreCircle score={analysis.overall_score ?? 0} size="md" />
        <div>
          <p className="text-xl font-semibold text-gray-900">
            {VERDICT_LABEL[analysis.verdict ?? "partial_match"] ?? "Match score"}
          </p>
          {analysis.verdict_summary && (
            <p className="mt-1 text-sm leading-6 text-gray-500 line-clamp-3">
              {analysis.verdict_summary}
            </p>
          )}
        </div>
      </div>

      {/* Apply recommendation */}
      {applyConfig && (
        <div className={cn("rounded-2xl border px-4 py-3 text-sm font-medium", applyConfig.className)}>
          {applyConfig.label}
          {analysis.apply_reasoning && (
            <p className="mt-1 text-xs font-normal opacity-80">{analysis.apply_reasoning}</p>
          )}
        </div>
      )}

      {/* Top missing skills */}
      {topMissingSkills.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
            Top missing skills
          </p>
          <div className="flex flex-wrap gap-2">
            {topMissingSkills.map((skill) => (
              <span
                key={skill}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700"
              >
                <XCircle className="h-3 w-3" />
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Top missing keywords */}
      {topMissingKeywords.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
            Top missing ATS keywords
          </p>
          <div className="flex flex-wrap gap-2">
            {topMissingKeywords.map((kw) => (
              <span
                key={kw}
                className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-2 pt-2 border-t border-gray-100">
        <Link
          href={`/dashboard/resume/analyze/${jobId}`}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0369A1] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#075985]"
        >
          View full analysis
        </Link>
        <a
          href={applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
        >
          Apply directly
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  )
}

export default function QuickAnalysisDrawer({
  resumeId,
  jobId,
  jobTitle,
  applyUrl,
  onClose,
  autoAnalyze = false,
}: Props) {
  const { analysis, isLoading, isAnalyzing, error, triggerAnalysis } = useResumeAnalysis(
    resumeId,
    jobId
  )

  // Auto-trigger if no cached analysis and autoAnalyze is true
  useEffect(() => {
    if (!autoAnalyze) return
    if (!isLoading && !analysis && !isAnalyzing && !error) {
      void triggerAnalysis()
    }
  }, [autoAnalyze, isLoading, analysis, isAnalyzing, error, triggerAnalysis])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const busy = isLoading || isAnalyzing

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer */}
      <div className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-sm flex-col bg-white shadow-2xl sm:bottom-auto sm:left-auto sm:rounded-l-[32px]">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0369A1]">
              Match analysis
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-gray-900">{jobTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-gray-200 text-gray-500 transition hover:bg-gray-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {busy && (
            <div className="flex flex-col items-center gap-4 py-12">
              <Loader2 className="h-8 w-8 animate-spin text-[#0369A1]" />
              <p className="text-sm text-gray-500">
                {isAnalyzing ? "Analyzing your fit…" : "Loading analysis…"}
              </p>
            </div>
          )}

          {!busy && error && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700">Analysis failed</p>
              <p className="mt-1 text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => void triggerAnalysis()}
                className="mt-3 text-sm font-medium text-red-700 underline"
              >
                Try again
              </button>
            </div>
          )}

          {!busy && !error && !analysis && (
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <p className="text-sm text-gray-500">No analysis yet for this job.</p>
              <button
                type="button"
                onClick={() => void triggerAnalysis()}
                className="rounded-2xl bg-[#0369A1] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985]"
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
