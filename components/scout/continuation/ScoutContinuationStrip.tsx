"use client"

import { ArrowRight, BarChart2, Clock3, FileText, FlaskConical, ListTodo } from "lucide-react"
import type { ScoutResumableContext } from "@/lib/scout/continuation/types"
import { cn } from "@/lib/utils"

type Props = {
  contexts: ScoutResumableContext[]
  onOpen: (context: ScoutResumableContext) => void
}

type ContextVisual = {
  icon: React.ElementType
  tint: string
}

const CONTEXT_VISUAL: Record<ScoutResumableContext["type"], ContextVisual> = {
  workflow: {
    icon: ListTodo,
    tint: "text-violet-600 bg-violet-50 border-violet-200",
  },
  compare: {
    icon: BarChart2,
    tint: "text-blue-600 bg-blue-50 border-blue-200",
  },
  tailor: {
    icon: FileText,
    tint: "text-[#FF5C18] bg-orange-50 border-orange-200",
  },
  research: {
    icon: FlaskConical,
    tint: "text-emerald-600 bg-emerald-50 border-emerald-200",
  },
  application_queue: {
    icon: ListTodo,
    tint: "text-amber-700 bg-amber-50 border-amber-200",
  },
}

function formatPrompt(context: ScoutResumableContext): string {
  switch (context.type) {
    case "workflow":
      return `Resume ${context.title}?`
    case "compare":
      return `Continue ${context.title.toLowerCase()}?`
    case "tailor":
      return `Continue tailoring: ${context.title}`
    case "research":
      return `${context.title} is still available`
    case "application_queue":
      return `${context.title} is ready for review`
    default:
      return context.title
  }
}

export function ScoutContinuationStrip({ contexts, onOpen }: Props) {
  if (!contexts.length) return null

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
      <div className="mb-2 flex items-center gap-2">
        <Clock3 className="h-3.5 w-3.5 text-slate-400" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Continue where you left off
        </p>
      </div>

      <div className="space-y-1.5">
        {contexts.slice(0, 3).map((context) => {
          const visual = CONTEXT_VISUAL[context.type]
          const Icon = visual.icon

          return (
            <button
              key={`${context.type}:${context.id}`}
              type="button"
              onClick={() => onOpen(context)}
              className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50"
            >
              <span className={cn("flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg border", visual.tint)}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium text-slate-700">{formatPrompt(context)}</p>
              </span>
              <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
