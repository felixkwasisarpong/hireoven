"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { ChevronDown, GitBranch, GraduationCap, Radar } from "lucide-react"

const ResumeSignalView = dynamic(() => import("@/components/resume/ResumeSignalView"), { ssr: false })
const PivotView = dynamic(() => import("@/components/resume/PivotView"), { ssr: false })
const SkillGapEngine = dynamic(() => import("@/components/grow/SkillGapEngine"), { ssr: false })

export type PanelId = "positioning" | "pivot" | "skills"

const PANELS: Array<{
  id: PanelId
  label: string
  blurb: string
  icon: React.ElementType
}> = [
  {
    id: "positioning",
    label: "Positioning",
    blurb: "What field this resume actually signals, and how to sharpen it into one lane.",
    icon: Radar,
  },
  {
    id: "pivot",
    label: "Career pivot",
    blurb: "Where your existing skills already reach, and how much more of it sponsors.",
    icon: GitBranch,
  },
  {
    id: "skills",
    label: "Skill gaps",
    blurb: "Which missing skills unlock the most roles you are targeting.",
    icon: GraduationCap,
  },
]

/**
 * Positioning, Career Pivot and Skill Gaps, folded into the review.
 *
 * These were three separate tabs, which meant the findings that raise them
 * ("you read as two candidates", "you are aiming at a field that rarely
 * sponsors") sent the user somewhere else to act — and the finding did not
 * travel with them. Here they open in place, so the diagnosis and the decision
 * stay on the same screen.
 *
 * Each panel mounts only once opened. All three fetch their own corpus data, and
 * loading them eagerly would fire three requests for panels most users never
 * expand.
 */
export default function ResumeReviewPanels({ initialPanel }: { initialPanel?: PanelId | null }) {
  const [open, setOpen] = useState<PanelId | null>(initialPanel ?? null)

  return (
    <section className="mt-6">
      <h2 className="text-[13px] font-bold uppercase tracking-[0.12em] text-slate-400">
        Go deeper
      </h2>
      <p className="mt-1 text-[13px] text-slate-500">
        The decisions behind the findings above. They open here rather than sending you away.
      </p>

      <div className="mt-3 space-y-2">
        {PANELS.map((panel) => {
          const expanded = open === panel.id
          const Icon = panel.icon
          return (
            <div
              key={panel.id}
              id={panel.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white scroll-mt-4"
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`panel-body-${panel.id}`}
                onClick={() => setOpen(expanded ? null : panel.id)}
                className="flex w-full items-center gap-3 px-5 py-3.5 text-left transition hover:bg-slate-50"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                    expanded
                      ? "border-orange-200 bg-orange-50 text-orange-700"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-slate-900">{panel.label}</span>
                  <span className="mt-0.5 block text-[12.5px] leading-relaxed text-slate-500">
                    {panel.blurb}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>

              {expanded && (
                <div id={`panel-body-${panel.id}`} className="border-t border-slate-100 p-4">
                  {panel.id === "positioning" && <ResumeSignalView />}
                  {panel.id === "pivot" && <PivotView />}
                  {panel.id === "skills" && <SkillGapEngine />}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
