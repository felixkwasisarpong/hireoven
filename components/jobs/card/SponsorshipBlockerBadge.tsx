import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SponsorshipBlocker } from "@/types"

type SponsorshipBlockerBadgeProps = {
  blockers: SponsorshipBlocker[] | null | undefined
  className?: string
}

const KIND_LABELS: Partial<Record<NonNullable<SponsorshipBlocker["kind"]>, string>> = {
  no_sponsorship_statement: "No sponsorship",
  requires_unrestricted_work_authorization: "Work auth required",
  citizenship_or_clearance_required: "Clearance required",
  contract_or_vendor_restriction: "Contractor restriction",
  location_or_role_restriction: "Location restriction",
}

export function SponsorshipBlockerBadge({ blockers, className }: SponsorshipBlockerBadgeProps) {
  const active = blockers?.find((b) => b.detected)
  if (!active) return null

  const label = (active.kind && KIND_LABELS[active.kind]) ?? "Sponsorship note"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full ring-1 px-2.5 py-0.5 text-[11px] font-semibold",
        active.severity === "high"
          ? "bg-red-50 text-red-800 ring-red-200"
          : "bg-amber-50 text-amber-800 ring-amber-200",
        className
      )}
      title={active.evidence?.[0] ?? undefined}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
      {label}
    </span>
  )
}
