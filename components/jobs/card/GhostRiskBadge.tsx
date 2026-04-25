import { Ghost } from "lucide-react"
import { cn } from "@/lib/utils"
import type { IntelligenceRiskLevel } from "@/types"

type GhostRiskBadgeProps = {
  riskLevel: IntelligenceRiskLevel | null | undefined
  freshnessDays?: number | null
  className?: string
}

export function GhostRiskBadge({ riskLevel, freshnessDays, className }: GhostRiskBadgeProps) {
  if (!riskLevel || riskLevel === "unknown" || riskLevel === "low") return null

  const isHigh = riskLevel === "high"
  const label = isHigh ? "High ghost risk" : "Possible ghost"
  const stale = typeof freshnessDays === "number" && freshnessDays > 30

  if (!isHigh && !stale) return null

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full ring-1 px-2.5 py-0.5 text-[11px] font-semibold",
        isHigh
          ? "bg-red-50 text-red-800 ring-red-200"
          : "bg-amber-50 text-amber-800 ring-amber-200",
        className
      )}
    >
      <Ghost className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  )
}
