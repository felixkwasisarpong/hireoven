"use client"

import { cn } from "@/lib/utils"
import type { PipelineStats } from "@/types"

const FUNNEL = [
  { key: "applied", label: "Applied", bar: "bg-blue-400", chip: "bg-blue-50 text-blue-700" },
  { key: "phone_screen", label: "Screen", bar: "bg-amber-400", chip: "bg-amber-50 text-amber-700" },
  { key: "interview", label: "Interview", bar: "bg-violet-400", chip: "bg-violet-50 text-violet-700" },
  { key: "final_round", label: "Final", bar: "bg-indigo-500", chip: "bg-indigo-50 text-indigo-700" },
  { key: "offer", label: "Offer", bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700" },
]

type Props = { stats: PipelineStats }

export function PipelineStatsPanel({ stats }: Props) {
  const maxCount = Math.max(...FUNNEL.map((f) => (stats.by_status as any)[f.key] ?? 0), 1)

  const statCards = [
    {
      label: "Total tracked",
      value: stats.total,
      sub: `${stats.applications_this_week} this week`,
    },
    {
      label: "Response rate",
      value: `${stats.response_rate}%`,
      sub: `avg ${stats.avg_days_to_response}d to hear back`,
    },
    {
      label: "Offers received",
      value: stats.by_status.offer ?? 0,
      sub: `${stats.conversion_rates.overall}% overall conversion`,
    },
    {
      label: "Active rounds",
      value:
        (stats.by_status.phone_screen ?? 0) +
        (stats.by_status.interview ?? 0) +
        (stats.by_status.final_round ?? 0),
      sub: "screen + interview + final",
    },
  ]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statCards.map((c) => (
          <div
            key={c.label}
            className="rounded-[16px] border border-slate-200/80 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]"
          >
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-400">{c.label}</p>
            <p className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900">{c.value}</p>
            <p className="mt-1 text-[11.5px] text-slate-500">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="rounded-[16px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
        <p className="mb-4 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-400">Pipeline funnel</p>
        <div className="space-y-2.5">
          {FUNNEL.map((f) => {
            const count = (stats.by_status as any)[f.key] ?? 0
            const pct = Math.round((count / maxCount) * 100)
            return (
              <div key={f.key} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-right text-[11.5px] font-medium text-slate-500">{f.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn("h-full rounded-full transition-all duration-500", f.bar)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={cn("w-7 rounded-full py-0.5 text-center text-[10.5px] font-semibold", f.chip)}>
                  {count}
                </span>
              </div>
            )
          })}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-2 border-t border-slate-100 pt-4">
          {[
            { label: "App → Screen", value: `${stats.conversion_rates.applied_to_phone}%` },
            { label: "Screen → Interview", value: `${stats.conversion_rates.phone_to_interview}%` },
            { label: "Interview → Offer", value: `${stats.conversion_rates.interview_to_offer}%` },
          ].map((r) => (
            <div key={r.label} className="text-center">
              <p className="text-xl font-bold text-slate-800">{r.value}</p>
              <p className="mt-0.5 text-[10.5px] text-slate-400">{r.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
