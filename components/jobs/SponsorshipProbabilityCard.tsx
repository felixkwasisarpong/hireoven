"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { ChevronRight, Info } from "lucide-react"
import { H1BPredictionProvider, useH1BPrediction } from "@/lib/context/H1BPredictionContext"
import { cn } from "@/lib/utils"
import type { H1BPrediction } from "@/types"

const H1BPredictionDrawer = dynamic(
  () => import("@/components/h1b/H1BPredictionDrawer"),
  { ssr: false }
)

export type ProbabilityTier = "High" | "Medium" | "Low" | "Unknown"

const TONE: Record<ProbabilityTier, { dot: string; text: string }> = {
  High: { dot: "bg-emerald-500", text: "text-emerald-700" },
  Medium: { dot: "bg-amber-500", text: "text-amber-700" },
  Low: { dot: "bg-slate-400", text: "text-slate-700" },
  Unknown: { dot: "bg-slate-300", text: "text-slate-500" },
}

type Props = {
  jobId: string
  jobTitle: string
  companyName: string
  tier: ProbabilityTier
  scorePercent: number | null
  initialPrediction: H1BPrediction | null
  /** Sits on a shared white panel; use inset “sub-card” instead of a second top-level card */
  variant?: "default" | "nested"
}

const BTN_NESTED =
  "w-full rounded-lg bg-transparent pt-4 text-left transition hover:bg-slate-50/70"
const BTN_STANDALONE =
  "w-full rounded-2xl bg-white p-5 text-left shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition hover:bg-slate-50/80 hover:shadow-[0_2px_6px_rgba(15,23,42,0.08)] sm:p-6"

function Inner({
  jobId,
  jobTitle,
  companyName,
  tier,
  scorePercent,
  initialPrediction,
  variant = "default",
}: Props) {
  const [open, setOpen] = useState(false)
  const { attachRef, prediction, isLoading } = useH1BPrediction(jobId)
  const combined = prediction ?? initialPrediction

  const tone = TONE[tier]
  const valueLabel =
    tier === "Unknown"
      ? "Unknown"
      : scorePercent != null
        ? `${tier} (${scorePercent}%)`
        : tier

  return (
    <>
      <button
        ref={attachRef as (node: HTMLButtonElement | null) => void}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open H-1B and LCA prediction"
        className={cn(
          "group block",
          variant === "nested" ? BTN_NESTED : BTN_STANDALONE,
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/40"
        )}
      >
        <div className="flex items-center gap-1.5">
          <h3 className="text-[14px] font-semibold text-slate-900">Sponsorship probability</h3>
          <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        </div>

        <div className="mt-3 flex items-center gap-2.5">
          <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
          <span className={`text-[20px] font-bold tracking-tight ${tone.text}`}>{valueLabel}</span>
        </div>

        <div className="mt-2 flex items-center justify-between text-[13px] text-slate-500">
          <span>Click to see details</span>
          <ChevronRight
            className="h-4 w-4 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-600"
            aria-hidden
          />
        </div>
      </button>

      {open ? (
        <H1BPredictionDrawer
          jobId={jobId}
          jobTitle={jobTitle}
          companyName={companyName}
          prediction={combined}
          isLoading={isLoading && !combined}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

/**
 * Click-through sponsorship probability card. Opens the H-1B / LCA prediction drawer
 * (employer LCA history, role signals, deep analysis) instead of navigating to a page.
 *
 * Wraps `H1BPredictionProvider` so the drawer can lazy-fetch prediction data via the
 * batch endpoint when the card scrolls into view (or immediately on click).
 */
export default function SponsorshipProbabilityCard(props: Props) {
  return (
    <H1BPredictionProvider enabled>
      <Inner {...props} />
    </H1BPredictionProvider>
  )
}
