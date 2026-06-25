import { cn } from "@/lib/utils"

export function EverifyBadge({ size = "default" }: { size?: "sm" | "default" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium ring-1 ring-inset",
        "bg-sky-50 text-sky-700 ring-sky-200",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm"
      )}
      title="Enrolled in the federal E-Verify program — eligible for STEM OPT hires"
    >
      {size === "sm" ? "E-Verify" : "E-Verify Enrolled"}
    </span>
  )
}
