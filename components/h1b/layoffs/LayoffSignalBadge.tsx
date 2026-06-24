import { cn } from "@/lib/utils"
import type { LayoffSignalBase, LayoffHue } from "@/lib/h1b/layoff-signal"

// Light-theme hue classes (public /h1b-sponsors pages are light). Calm palette —
// slate for stable so "no layoffs" doesn't read as a warning colour.
const HUE_CLASSES: Record<LayoffHue, string> = {
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  red: "bg-red-50 text-red-700 ring-red-200",
}

export function LayoffSignalBadge({
  signal,
  size = "default",
}: {
  signal: Pick<LayoffSignalBase, "level" | "label" | "short" | "hue">
  size?: "sm" | "default"
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium ring-1 ring-inset",
        HUE_CLASSES[signal.hue],
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      )}
      title={signal.label}
    >
      {size === "sm" ? signal.short : signal.label}
    </span>
  )
}
