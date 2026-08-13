"use client"

import { useState } from "react"
import { AlertTriangle, ChevronDown } from "lucide-react"
import type { RecommendedAction, RejectionRisk } from "@/lib/application-xray/types"
import { cn } from "@/lib/utils"
import { XRayConfidence } from "./XRayConfidence"
import { presentRisk } from "./xray-presenters"

const SEVERITY_CLASS: Record<RejectionRisk["severity"], string> = {
  critical: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100",
  high: "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-100",
  moderate: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100",
  low: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
}

export function XRayRiskList({
  risks,
  actions,
}: {
  risks: RejectionRisk[]
  actions: RecommendedAction[]
}) {
  const [showAll, setShowAll] = useState(false)
  const visibleRisks = risks.slice(0, showAll ? 6 : 3).map(presentRisk)
  const actionById = new Map(actions.map((action) => [action.id, action]))

  return (
    <section aria-labelledby="xray-risks-heading">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 id="xray-risks-heading" className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
          Rejection risks
        </h4>
        {risks.length > 3 ? (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            aria-expanded={showAll}
            className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10.5px] font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 dark:text-slate-400 dark:hover:bg-slate-900"
          >
            {showAll ? "Show top 3" : "Show all"}
            <ChevronDown className={cn("h-3 w-3 transition-transform", showAll && "rotate-180")} aria-hidden />
          </button>
        ) : null}
      </div>

      {visibleRisks.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-3 text-[12px] leading-relaxed text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
          No specific rejection risk surfaced from the current X-Ray data.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {visibleRisks.map((risk) => {
            const action = risk.addressableByActionId ? actionById.get(risk.addressableByActionId) : null
            return (
              <li key={risk.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold leading-relaxed text-slate-900 dark:text-slate-100">
                      {risk.statement}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", SEVERITY_CLASS[risk.severity])}>
                        {risk.severity}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {risk.basisLabel}
                      </span>
                      <XRayConfidence confidence={risk.confidence} />
                    </div>
                    {action ? (
                      <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                        Action: {action.label}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
