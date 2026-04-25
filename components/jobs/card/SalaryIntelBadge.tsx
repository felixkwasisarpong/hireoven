import { TrendingDown, TrendingUp, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { LcaSalaryComparisonLabel } from "@/types"

type SalaryIntelBadgeProps = {
  comparisonLabel: LcaSalaryComparisonLabel | null | undefined
  className?: string
}

const CONFIG: Record<
  LcaSalaryComparisonLabel,
  { icon: typeof Minus | typeof TrendingDown | typeof TrendingUp; classes: string } | null
> = {
  Aligned: {
    icon: Minus,
    classes: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  },
  "Below Market": {
    icon: TrendingDown,
    classes: "bg-amber-50 text-amber-800 ring-amber-200",
  },
  "Above Market": {
    icon: TrendingUp,
    classes: "bg-sky-50 text-sky-800 ring-sky-200",
  },
  Unknown: null,
}

export function SalaryIntelBadge({ comparisonLabel, className }: SalaryIntelBadgeProps) {
  if (!comparisonLabel) return null
  const config = CONFIG[comparisonLabel]
  if (!config) return null

  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full ring-1 px-2.5 py-0.5 text-[11px] font-semibold",
        config.classes,
        className
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {comparisonLabel}
    </span>
  )
}
