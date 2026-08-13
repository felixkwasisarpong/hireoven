import { Database } from "lucide-react"
import type { XRayDataGap } from "@/lib/application-xray/types"
import { presentDataGapLabel, sanitizePresentationText } from "./xray-presenters"

export function XRayDataGaps({ gaps }: { gaps: XRayDataGap[] }) {
  const visibleGaps = gaps.slice(0, 5)
  if (visibleGaps.length === 0) return null

  return (
    <section
      aria-labelledby="xray-gaps-heading"
      className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-900/70"
    >
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-slate-400" aria-hidden />
        <h4 id="xray-gaps-heading" className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">
          Data gaps
        </h4>
      </div>
      <ul className="mt-3 space-y-2.5">
        {visibleGaps.map((gap) => (
          <li key={gap.id} className="text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {presentDataGapLabel(gap.label)}
            </span>
            <span className="block text-slate-500 dark:text-slate-400">
              {sanitizePresentationText(gap.whyNotDefaulted)}
            </span>
            {gap.resolution?.step ? (
              <span className="mt-1 block text-slate-500 dark:text-slate-400">
                {sanitizePresentationText(gap.resolution.step)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
