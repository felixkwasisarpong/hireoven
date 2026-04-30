"use client"

import { useState } from "react"
import { CheckCircle2, ChevronDown, ChevronUp, Lock, Sparkles, Zap } from "lucide-react"
import type { FeatureKey } from "@/lib/gates"
import type { ScoutResponse } from "@/lib/scout/types"
import { getScoutDisplayText } from "@/lib/scout/display-text"
import { ScoutActionRenderer } from "./ScoutActionRenderer"
import { ScoutCompareRenderer } from "./ScoutCompareRenderer"
import { ScoutExplanationRenderer } from "./ScoutExplanationRenderer"
import { ScoutInterviewPrepRenderer } from "./ScoutInterviewPrepRenderer"
import { ScoutWorkflowRenderer } from "./ScoutWorkflowRenderer"
import { ScoutGraphRenderer } from "./renderers/ScoutGraphRenderer"

const RECOMMENDATION_CONFIG = {
  Apply:   { bg: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  Skip:    { bg: "bg-red-500",     pill: "bg-red-50 text-red-700 border-red-200" },
  Improve: { bg: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200" },
  Wait:    { bg: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200" },
  Explore: { bg: "bg-orange-500",  pill: "bg-orange-50 text-orange-700 border-orange-200" },
} as const

const IS_DEV = process.env.NODE_ENV === "development"

type Props = {
  response:  ScoutResponse
  compact?:  boolean
  onUpgrade: (feature: FeatureKey) => void
}

/** Collapsible raw payload panel — only rendered in development. */
function DebugPanel({ response }: { response: ScoutResponse }) {
  const [open, setOpen] = useState(false)
  if (!IS_DEV) return null

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400"
      >
        Debug payload
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-slate-200 px-3 py-2 text-[10px] leading-4 text-slate-600">
          {JSON.stringify(response, null, 2)}
        </pre>
      )}
    </div>
  )
}

export function ScoutMessageBubble({ response, compact = false, onUpgrade }: Props) {
  const recConfig =
    RECOMMENDATION_CONFIG[response.recommendation] ?? RECOMMENDATION_CONFIG.Explore

  // ── Use canonical display-text utility — never raw `.answer` ──────────────
  const answer = getScoutDisplayText(response.answer)

  const hasStructuredDetails =
    Boolean(response.explanations?.length) ||
    Boolean(response.compare) ||
    Boolean(response.interviewPrep) ||
    Boolean(response.actions?.length) ||
    Boolean(response.workflow) ||
    Boolean(response.graph)

  return (
    <div className={`group flex items-start ${compact ? "gap-2.5" : "gap-3"}`}>
      {/* Avatar */}
      <div
        className={`relative mt-0.5 flex-shrink-0 inline-flex items-center justify-center bg-[#FF5C18] ${
          compact
            ? "h-7 w-7 rounded-xl shadow-[0_4px_14px_rgba(255,92,24,0.3)]"
            : "h-9 w-9 rounded-xl shadow-[0_4px_16px_rgba(255,92,24,0.35)]"
        }`}
      >
        <Sparkles className={compact ? "h-3.5 w-3.5 text-white" : "h-4 w-4 text-white"} />
      </div>

      {/* Bubble */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-sm border border-slate-100 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.07)] transition-shadow group-hover:shadow-[0_8px_28px_rgba(15,23,42,0.1)]">
        {/* Coloured accent bar keyed to recommendation */}
        <div className={`h-[3px] w-full ${recConfig.bg} opacity-80`} />

        <div className={compact ? "p-3" : "p-4 sm:p-5"}>
          {/* Header badges */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wide ${recConfig.pill} ${
                  compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs"
                }`}
              >
                <CheckCircle2 className="h-3 w-3" />
                {response.recommendation}
              </span>

              {response.mode && (
                <span
                  className={`rounded-full bg-slate-100 font-semibold uppercase tracking-wide text-slate-500 ${
                    compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-[11px]"
                  }`}
                >
                  {response.mode}
                </span>
              )}
            </div>

            {!compact && (response.intent || typeof response.confidence === "number") && (
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
                {response.intent ?? "Scout"}
                {typeof response.confidence === "number"
                  ? ` - ${Math.round(response.confidence * 100)}%`
                  : ""}
              </span>
            )}
          </div>

          {/* Answer text — sanitized, never raw JSON */}
          {answer && (
            <p
              className={`mt-2.5 whitespace-pre-wrap text-slate-800 ${
                compact ? "text-xs leading-5" : "text-sm leading-7"
              }`}
            >
              {answer}
            </p>
          )}

          {/* Fallback when answer is empty but structured content exists */}
          {!answer && hasStructuredDetails && (
            <p className={`mt-2.5 text-slate-600 ${compact ? "text-xs leading-5" : "text-sm leading-6"}`}>
              Scout prepared the structured guidance below.
            </p>
          )}

          {/* Graph renderer — for score breakdowns, bar charts, market signals */}
          {response.graph && (
            <ScoutGraphRenderer graph={response.graph} compact={compact} />
          )}

          {/* Visual explanation blocks */}
          <ScoutExplanationRenderer
            explanations={response.explanations}
            compact={compact}
          />

          {/* Job comparison */}
          {response.compare && (
            <ScoutCompareRenderer compare={response.compare} />
          )}

          {/* Job-specific interview prep */}
          {response.interviewPrep && (
            <ScoutInterviewPrepRenderer interviewPrep={response.interviewPrep} />
          )}

          {/* Suggested actions */}
          <ScoutActionRenderer actions={response.actions} source="chat" />

          {/* Guided workflow */}
          {response.workflow && <ScoutWorkflowRenderer workflow={response.workflow} />}

          {/* Gated upgrade card */}
          {response.gated && (
            <div
              className={`rounded-xl border border-[#FFD2B8] bg-[#FFF7F2] ${
                compact ? "mt-3 p-3" : "mt-4 p-4"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#FFF1E8]">
                  <Lock className="h-4 w-4 text-[#FF5C18]" />
                </div>
                <div className="flex-1">
                  <p
                    className={`font-semibold text-[#9A3412] ${
                      compact ? "text-xs" : "text-sm"
                    }`}
                  >
                    Premium Scout feature
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[#C2410C]">
                    {response.gated.upgradeMessage}
                  </p>
                  <button
                    type="button"
                    onClick={() => onUpgrade(response.gated!.feature)}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#FF5C18] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#E14F0E]"
                  >
                    <Zap className="h-3 w-3" />
                    Upgrade to unlock
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Dev-only debug panel */}
          <DebugPanel response={response} />
        </div>
      </div>
    </div>
  )
}
