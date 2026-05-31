"use client"

import { Info } from "lucide-react"
import type {
  ScoutExplanationBlock,
  ScoutExplanationItemStatus,
  ScoutStandardExplanationBlock,
} from "@/lib/scout/types"
import { ScoutEvidenceBridge } from "./ScoutEvidenceBridge"

type ScoutExplanationRendererProps = {
  explanations?: ScoutExplanationBlock[]
  compact?: boolean
}

const STATUS_STYLES: Record<ScoutExplanationItemStatus, string> = {
  strong: "border-emerald-200 bg-emerald-50 text-emerald-700",
  medium: "border-blue-200 bg-blue-50 text-blue-700",
  weak: "border-amber-200 bg-amber-50 text-amber-700",
  missing: "border-red-200 bg-red-50 text-red-700",
  unknown: "border-slate-200 bg-slate-100 text-slate-600",
}

const BLOCK_LABELS: Record<ScoutStandardExplanationBlock["type"], string> = {
  match_breakdown: "Match breakdown",
  resume_gap: "Resume gaps",
  sponsorship_signal: "Sponsorship signals",
  application_risk: "Application risk",
  next_action: "Next action",
}

function StandardExplanationBlock({
  block,
  compact,
}: {
  block: ScoutStandardExplanationBlock
  compact: boolean
}) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white ${compact ? "p-3" : "p-3.5"}`}
    >
      <div className="mb-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {BLOCK_LABELS[block.type]}
          </span>
          <p className="text-sm font-semibold text-slate-900">{block.title}</p>
        </div>
        {block.summary && (
          <p className="mt-1 text-xs leading-5 text-slate-500">{block.summary}</p>
        )}
      </div>

      <div className="space-y-2">
        {block.items.map((item, itemIndex) => (
          <article
            key={`${item.label}-${itemIndex}`}
            className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold text-slate-800">{item.label}</p>
              {item.status && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[item.status]}`}
                >
                  {item.status}
                </span>
              )}
            </div>

            {(item.evidence || item.recommendation) && (
              <div className="mt-1.5 space-y-1.5 text-xs leading-5 text-slate-600">
                {item.evidence && (
                  <p>
                    <span className="font-semibold text-slate-500">Evidence:</span>{" "}
                    {item.evidence}
                  </p>
                )}
                {item.recommendation && (
                  <p>
                    <span className="font-semibold text-slate-500">Recommendation:</span>{" "}
                    {item.recommendation}
                  </p>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

export function ScoutExplanationRenderer({
  explanations,
  compact = false,
}: ScoutExplanationRendererProps) {
  if (!explanations || explanations.length === 0) return null

  return (
    <div className={compact ? "mt-3 space-y-3" : "mt-4 space-y-3"}>
      {explanations.map((block, blockIndex) => {
        const key = `${block.type}-${block.title}-${blockIndex}`

        if (block.type === "evidence_bridge") {
          return <ScoutEvidenceBridge key={key} block={block} compact={compact} />
        }

        return <StandardExplanationBlock key={key} block={block} compact={compact} />
      })}

      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <Info className="h-3.5 w-3.5" />
        Visual explanations only use evidence available in Scout context.
      </div>
    </div>
  )
}
