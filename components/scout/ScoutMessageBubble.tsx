"use client"

/**
 * ScoutMessageBubble — layout shell for Scout chat messages.
 *
 * Renders the avatar, bubble container, recommendation badge, and metadata.
 * All content routing (text, actions, workflow, compare, graph...) is
 * delegated to ScoutResponseRenderer.
 *
 * Both /dashboard/scout and ScoutMiniPanel use this component,
 * so renderer behavior is always identical across surfaces.
 */

import { CheckCircle2, Lock, Zap, Sparkles } from "lucide-react"
import type { FeatureKey } from "@/lib/gates"
import type { ScoutResponse } from "@/lib/scout/types"
import { ScoutResponseRenderer } from "./ScoutResponseRenderer"
import type { ScoutRenderContext } from "@/lib/scout/normalize-scout-response"

const RECOMMENDATION_CONFIG = {
  Apply:   { bg: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  Skip:    { bg: "bg-red-500",     pill: "bg-red-50 text-red-700 border-red-200" },
  Improve: { bg: "bg-amber-500",   pill: "bg-amber-50 text-amber-700 border-amber-200" },
  Wait:    { bg: "bg-blue-500",    pill: "bg-blue-50 text-blue-700 border-blue-200" },
  Explore: { bg: "bg-orange-500",  pill: "bg-orange-50 text-orange-700 border-orange-200" },
} as const

type Props = {
  response:  ScoutResponse
  /** Pass "mini" for compact Scout surfaces — ScoutResponseRenderer adapts automatically */
  context?:  ScoutRenderContext
  compact?:  boolean
  onUpgrade: (feature: FeatureKey) => void
}

export function ScoutMessageBubble({ response, context = "dashboard", compact = false, onUpgrade }: Props) {
  const recConfig =
    RECOMMENDATION_CONFIG[response.recommendation] ?? RECOMMENDATION_CONFIG.Explore
  const isCompact = compact || context === "mini" || context === "extension"

  return (
    <div className={`group flex items-start ${isCompact ? "gap-2.5" : "gap-3"}`}>
      {/* Avatar */}
      <div
        className={`relative mt-0.5 flex-shrink-0 inline-flex items-center justify-center bg-[#FF5C18] ${
          isCompact
            ? "h-7 w-7 rounded-xl shadow-[0_4px_14px_rgba(255,92,24,0.3)]"
            : "h-9 w-9 rounded-xl shadow-[0_4px_16px_rgba(255,92,24,0.35)]"
        }`}
      >
        <Sparkles className={isCompact ? "h-3.5 w-3.5 text-white" : "h-4 w-4 text-white"} />
      </div>

      {/* Bubble */}
      <div className="min-w-0 flex-1 overflow-hidden rounded-2xl rounded-tl-sm border border-slate-100 bg-white shadow-[0_4px_20px_rgba(15,23,42,0.07)] transition-shadow group-hover:shadow-[0_8px_28px_rgba(15,23,42,0.1)]">
        {/* Coloured accent bar */}
        <div className={`h-[3px] w-full ${recConfig.bg} opacity-80`} />

        <div className={isCompact ? "p-3" : "p-4 sm:p-5"}>
          {/* Header badges */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded-full border font-semibold uppercase tracking-wide ${recConfig.pill} ${
                  isCompact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs"
                }`}
              >
                <CheckCircle2 className="h-3 w-3" />
                {response.recommendation}
              </span>

              {response.mode && (
                <span
                  className={`rounded-full bg-slate-100 font-semibold uppercase tracking-wide text-slate-500 ${
                    isCompact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-[11px]"
                  }`}
                >
                  {response.mode}
                </span>
              )}
            </div>

            {!isCompact && (response.intent || typeof response.confidence === "number") && (
              <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
                {response.intent ?? "Scout"}
                {typeof response.confidence === "number"
                  ? ` - ${Math.round(response.confidence * 100)}%`
                  : ""}
              </span>
            )}
          </div>

          {/* ── All content routing via ScoutResponseRenderer ─────────── */}
          <div className="mt-2.5">
            <ScoutResponseRenderer
              response={response}
              context={context}
              onUpgrade={onUpgrade}
            />
          </div>

          {/* Gated upgrade card */}
          {response.gated && (
            <div
              className={`rounded-xl border border-[#FFD2B8] bg-[#FFF7F2] ${
                isCompact ? "mt-3 p-3" : "mt-4 p-4"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#FFF1E8]">
                  <Lock className="h-4 w-4 text-[#FF5C18]" />
                </div>
                <div className="flex-1">
                  <p className={`font-semibold text-[#9A3412] ${isCompact ? "text-xs" : "text-sm"}`}>
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
        </div>
      </div>
    </div>
  )
}
