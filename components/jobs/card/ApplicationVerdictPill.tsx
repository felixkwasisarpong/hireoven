import { CheckCircle2, XCircle, Eye, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ApplicationVerdict } from "@/types"

type ApplicationVerdictPillProps = {
  verdict: ApplicationVerdict | null | undefined
  className?: string
}

type Recommendation = ApplicationVerdict["recommendation"]

const CONFIG: Partial<
  Record<
    Recommendation,
    { icon: typeof CheckCircle2; classes: string; text: string }
  >
> = {
  apply_now: {
    icon: CheckCircle2,
    classes:
      "border-0 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white ring-0 shadow-[0_2px_12px_rgba(5,150,105,0.45),inset_0_1px_0_rgba(255,255,255,0.18)] [&_svg]:text-white",
    text: "Apply Today",
  },
  apply_with_tweaks: {
    icon: Eye,
    classes: "bg-sky-50 text-sky-800 ring-sky-200",
    text: "Customize Resume",
  },
  watch: {
    icon: Eye,
    classes: "bg-slate-50 text-slate-700 ring-slate-200",
    text: "Watch",
  },
  stretch_role: {
    icon: Minus,
    classes: "bg-amber-50 text-amber-800 ring-amber-200",
    text: "Stretch role",
  },
  avoid: {
    icon: XCircle,
    classes: "bg-red-50 text-red-800 ring-red-200",
    text: "High Risk",
  },
  skip: {
    icon: XCircle,
    classes: "bg-red-50 text-red-800 ring-red-200",
    text: "Skip",
  },
}

export function ApplicationVerdictPill({ verdict, className }: ApplicationVerdictPillProps) {
  if (!verdict || !verdict.recommendation || verdict.recommendation === "unknown") return null

  const config = CONFIG[verdict.recommendation]
  if (!config) return null

  const Icon = config.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-tight ring-1",
        config.classes,
        className
      )}
      title={verdict.reasons?.[0] ?? undefined}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {verdict.verdict && verdict.verdict !== "Unknown" ? verdict.verdict : config.text}
    </span>
  )
}
