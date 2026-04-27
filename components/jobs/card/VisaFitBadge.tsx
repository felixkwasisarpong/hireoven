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
    classes:
      "bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 text-emerald-900 ring-emerald-200/80 shadow-[0_1px_6px_rgba(16,185,129,0.14)]",
    text: "Very Strong Visa Fit",
  },
  Strong: {
    icon: ShieldCheck,
    classes:
      "bg-gradient-to-r from-emerald-50 via-teal-50 to-cyan-50/80 text-emerald-900 ring-emerald-200/70 shadow-[0_1px_5px_rgba(20,184,166,0.12)]",
    text: "Strong Visa Fit",
  },
  Medium: {
    icon: Plane,
    classes:
      "bg-gradient-to-r from-violet-100 via-indigo-50 to-sky-50 text-indigo-950 ring-indigo-300/55 shadow-[0_2px_10px_rgba(99,102,241,0.18)] [&_svg]:text-indigo-600",
    text: "Possible Visa Fit",
  },
  Weak: {
    icon: ShieldQuestion,
    classes:
      "bg-gradient-to-r from-amber-50 to-orange-50/90 text-amber-950 ring-amber-200/80 shadow-[0_1px_5px_rgba(245,158,11,0.12)]",
    text: "Weak Visa Fit",
  },
  Blocked: {
    icon: ShieldAlert,
    classes:
      "bg-gradient-to-r from-red-50 to-rose-50 text-red-900 ring-red-200/80 shadow-[0_1px_5px_rgba(239,68,68,0.12)]",
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
