"use client"

import { CheckCircle2, CircleDashed, Info, XCircle, AlertCircle, Lightbulb } from "lucide-react"
import type { ScoutEvidenceBridgeBlock, ScoutEvidenceBridgeItemStatus } from "@/lib/scout/types"

type ScoutEvidenceBridgeProps = {
  block: ScoutEvidenceBridgeBlock
  compact?: boolean
}

const STATUS_CONFIG: Record<
  ScoutEvidenceBridgeItemStatus,
  { label: string; badgeClass: string; Icon: React.ElementType }
> = {
  strong:  { label: "Matched",  badgeClass: "border-emerald-200 bg-emerald-50 text-emerald-700",  Icon: CheckCircle2 },
  partial: { label: "Partial",  badgeClass: "border-amber-200  bg-amber-50  text-amber-700",    Icon: AlertCircle  },
  missing: { label: "Missing",  badgeClass: "border-red-200    bg-red-50    text-red-700",      Icon: XCircle      },
  unknown: { label: "Unknown",  badgeClass: "border-slate-200  bg-slate-100 text-slate-500",    Icon: CircleDashed },
}

export function ScoutEvidenceBridge({ block, compact = false }: ScoutEvidenceBridgeProps) {
  const pad = compact ? "p-3" : "p-3.5"

  return (
    <section className={`rounded-xl border border-slate-200 bg-white ${pad}`}>
      {/* Header */}
      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-600">
            Evidence bridge
          </span>
          <p className="text-sm font-semibold text-slate-900">{block.title}</p>
        </div>
        {block.summary && (
          <p className="mt-1 text-xs leading-5 text-slate-500">{block.summary}</p>
        )}
      </div>

      {/* Requirement rows */}
      <div className="space-y-2">
        {block.items.map((item, i) => {
          const { label, badgeClass, Icon } = STATUS_CONFIG[item.status]
          const hasDetail = item.resumeEvidence || item.suggestedFix

          return (
            <article
              key={`${item.requirement}-${i}`}
              className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
            >
              {/* Requirement + status badge */}
              <div className="flex flex-wrap items-start gap-2">
                <p className="min-w-0 flex-1 text-xs font-semibold text-slate-800 leading-5">
                  {item.requirement}
                </p>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeClass}`}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </span>
              </div>

              {hasDetail && (
                <div className="mt-1.5 space-y-1 text-xs leading-5 text-slate-600">
                  {item.resumeEvidence && (
                    <p>
                      <span className="font-semibold text-slate-500">Resume:</span>{" "}
                      {item.resumeEvidence}
                    </p>
                  )}
                  {item.suggestedFix && item.status !== "strong" && (
                    <p className="flex items-start gap-1.5 text-orange-700">
                      <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
                      {item.suggestedFix}
                    </p>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-slate-400">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Based only on job and resume data available in Scout context.
      </div>
    </section>
  )
}
