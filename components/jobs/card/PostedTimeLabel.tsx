import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"

type PostedTimeLabelProps = {
  firstDetectedAt: string
  now?: number
  className?: string
}

export function formatFreshness(timestamp: string, now: number) {
  const minutes = Math.max(1, Math.floor((now - new Date(timestamp).getTime()) / 60_000))
  if (minutes < 60) return { label: `${minutes} min ago`, urgent: true }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { label: `${hours}h ago`, urgent: true }
  const days = Math.floor(hours / 24)
  if (days <= 3) return { label: `${days}d ago`, urgent: false }
  return { label: `${days}d ago`, urgent: false }
}

export function PostedTimeLabel({ firstDetectedAt, now, className }: PostedTimeLabelProps) {
  const ts = now ?? Date.now()
  const { label, urgent } = formatFreshness(firstDetectedAt, ts)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[12px] font-semibold",
        urgent ? "text-emerald-700" : "text-slate-500",
        className
      )}
    >
      <Clock className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  )
}
