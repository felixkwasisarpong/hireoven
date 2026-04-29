import { ShieldAlert, ShieldCheck, ShieldQuestion, Plane } from "lucide-react"
import { cn } from "@/lib/utils"
import type { VisaFitScoreLabel } from "@/types"

type VisaFitBadgeProps = {
  label: VisaFitScoreLabel | null | undefined
  score?: number | null
  className?: string
}

const CONFIG: Record<
  VisaFitScoreLabel,
  { icon: typeof ShieldCheck; classes: string; text: string }
> = {
  "Very Strong": {
    icon: ShieldCheck,
    classes: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    text: "Very Strong Visa Fit",
  },
  Strong: {
    icon: ShieldCheck,
    classes: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    text: "Strong Visa Fit",
  },
  Medium: {
    icon: Plane,
    classes: "bg-amber-50 text-amber-900 ring-amber-200",
    text: "Possible Visa Fit",
  },
  Weak: {
    icon: ShieldQuestion,
    classes: "bg-amber-50 text-amber-800 ring-amber-200",
    text: "Weak Visa Fit",
  },
  Blocked: {
    icon: ShieldAlert,
    classes: "bg-red-50 text-red-900 ring-red-200",
    text: "Sponsorship Blocked",
  },
}

export function VisaFitBadge({ label, score, className }: VisaFitBadgeProps) {
  if (!label) return null

  const config = CONFIG[label]
  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-tight ring-1",
        config.classes,
        className
      )}
      title={score != null ? `Visa Fit Score: ${score}/100` : undefined}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {config.text}
    </span>
  )
}
