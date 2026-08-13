import type { XRayConfidence as XRayConfidenceValue } from "@/lib/application-xray/types"
import { cn } from "@/lib/utils"
import { presentConfidence, type XRayTone } from "./xray-presenters"

const TONE_CLASSES: Record<XRayTone, string> = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200",
  attention: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200",
  critical: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200",
  neutral: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200",
}

export function xrayToneClasses(tone: XRayTone): string {
  return TONE_CLASSES[tone]
}

export function XRayConfidence({
  confidence,
  className,
}: {
  confidence: XRayConfidenceValue
  className?: string
}) {
  const presentation = presentConfidence(confidence)
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold",
        TONE_CLASSES[presentation.tone],
        className,
      )}
    >
      {presentation.label}
    </span>
  )
}
