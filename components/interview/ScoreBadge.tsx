import { cn } from "@/lib/utils"

export default function ScoreBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-[12px] text-slate-400">—</span>

  const cls =
    score >= 85 ? "bg-green-50 text-green-700"
    : score >= 70 ? "bg-emerald-50 text-emerald-700"
    : score >= 55 ? "bg-amber-50 text-amber-700"
    : score >= 40 ? "bg-orange-50 text-orange-700"
    : "bg-red-50 text-red-600"

  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", cls)}>
      {score}
    </span>
  )
}
