import { cn } from "@/lib/utils"

type Status = "setup" | "active" | "completed" | "abandoned"

const CONFIG: Record<Status, { label: string; cls: string }> = {
  setup:     { label: "Setup",     cls: "bg-slate-100 text-slate-600" },
  active:    { label: "Active",    cls: "bg-blue-50 text-blue-700" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700" },
  abandoned: { label: "Discarded", cls: "bg-slate-100 text-slate-500" },
}

export default function SessionStatusBadge({ status }: { status: string }) {
  const cfg = CONFIG[status as Status] ?? { label: status, cls: "bg-slate-100 text-slate-600" }
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", cfg.cls)}>
      {cfg.label}
    </span>
  )
}
