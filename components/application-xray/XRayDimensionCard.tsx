"use client"

import { useState } from "react"
import { AlertCircle, ChevronDown, Database, RefreshCw } from "lucide-react"
import type { ApplicationXRay, XRayDimensionKey } from "@/lib/application-xray/types"
import { cn } from "@/lib/utils"
import { XRayConfidence, xrayToneClasses } from "./XRayConfidence"
import {
  getDimensionAssessment,
  presentDataGapLabel,
  presentDimension,
  sanitizePresentationText,
} from "./xray-presenters"

export function XRayDimensionCard({
  xray,
  dimensionKey,
  onExpand,
}: {
  xray: ApplicationXRay
  dimensionKey: XRayDimensionKey
  onExpand?: (dimension: XRayDimensionKey) => void
}) {
  const [open, setOpen] = useState(false)
  const assessment = getDimensionAssessment(xray, dimensionKey)
  const presentation = presentDimension(dimensionKey, assessment)
  const findings = assessment.findings.slice(0, open ? 3 : 1)
  const gaps = assessment.dataGaps.slice(0, open ? 2 : 0)

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) onExpand?.(dimensionKey)
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3.5 text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-[13px] font-semibold">{presentation.title}</h4>
            {presentation.stale ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
                <RefreshCw className="h-3 w-3" aria-hidden />
                Stale input
              </span>
            ) : null}
            {presentation.hasDataGaps ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                <Database className="h-3 w-3" aria-hidden />
                Incomplete
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
            {presentation.question}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 motion-reduce:transition-none",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", xrayToneClasses(presentation.tone))}>
          {presentation.bandLabel}
        </span>
        <XRayConfidence confidence={assessment.confidence} />
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
        {presentation.explanation}
      </p>

      {findings.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {findings.map((finding) => (
            <li key={finding.id} className="flex gap-2 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <span>{sanitizePresentationText(finding.statement)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {gaps.length > 0 ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
          <p className="text-[10.5px] font-semibold uppercase text-slate-400">Data gaps</p>
          <ul className="mt-2 space-y-1.5">
            {gaps.map((gap) => (
              <li key={gap.id} className="text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                {presentDataGapLabel(gap.label)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  )
}
