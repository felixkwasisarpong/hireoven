import { cn } from "@/lib/utils"

const REASON_LABEL: Record<string, string> = {
  university: "University · Cap-Exempt",
  affiliated_nonprofit: "Affiliated Nonprofit · Cap-Exempt",
  govt_research: "Federal Research · Cap-Exempt",
  nonprofit_research: "Nonprofit Research · Cap-Exempt",
}

export function CapExemptBadge({
  reason,
  confidence,
  size = "default",
}: {
  reason: string
  confidence: "high" | "medium" | "low"
  size?: "sm" | "default"
}) {
  const label = REASON_LABEL[reason] ?? "Cap-Exempt"
  const tooltip =
    confidence === "low" ? "Likely cap-exempt — verify with the employer" : label
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium ring-1 ring-inset",
        "bg-violet-50 text-violet-700 ring-violet-200",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      )}
      title={tooltip}
    >
      {size === "sm" ? "Cap-Exempt" : label}
      {confidence === "low" && <span className="ml-1 opacity-60">?</span>}
    </span>
  )
}
