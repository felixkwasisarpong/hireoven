"use client"

import {
  AlertTriangle,
  Briefcase,
  Building2,
  MessageSquareText,
  Sparkles,
  Target,
} from "lucide-react"
import type { ComponentType } from "react"
import type { ScoutInterviewPrep } from "@/lib/scout/types"

type PrepSection = {
  title: string
  items: string[]
  icon: ComponentType<{ className?: string }>
  accent: string
}

type ScoutInterviewPrepRendererProps = {
  interviewPrep: ScoutInterviewPrep
}

function SectionCard({ section }: { section: PrepSection }) {
  const Icon = section.icon

  if (section.items.length === 0) return null

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-[0_1px_8px_rgba(15,23,42,0.04)]">
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ${section.accent}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">
          {section.title}
        </h4>
      </div>
      <ul className="space-y-1.5">
        {section.items.map((item, index) => (
          <li key={`${section.title}-${index}`} className="flex gap-2 text-xs leading-5 text-slate-700">
            <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ScoutInterviewPrepRenderer({ interviewPrep }: ScoutInterviewPrepRendererProps) {
  const sections: PrepSection[] = [
    {
      title: "Role Focus",
      items: interviewPrep.roleFocus,
      icon: Target,
      accent: "bg-orange-100 text-orange-700",
    },
    {
      title: "Likely Topics",
      items: interviewPrep.likelyTopics,
      icon: Briefcase,
      accent: "bg-blue-100 text-blue-700",
    },
    {
      title: "Resume Talking Points",
      items: interviewPrep.resumeTalkingPoints,
      icon: Sparkles,
      accent: "bg-emerald-100 text-emerald-700",
    },
    {
      title: "Gaps To Prepare",
      items: interviewPrep.gapsToPrepare,
      icon: AlertTriangle,
      accent: "bg-amber-100 text-amber-700",
    },
    {
      title: "Practice Questions",
      items: interviewPrep.practiceQuestions,
      icon: MessageSquareText,
      accent: "bg-rose-100 text-rose-700",
    },
    {
      title: "Company Notes",
      items: interviewPrep.companyNotes ?? [],
      icon: Building2,
      accent: "bg-slate-100 text-slate-700",
    },
  ]

  return (
    <div className="mt-4 rounded-2xl border border-orange-100 bg-orange-50/40 p-3">
      <div className="mb-3 flex items-center gap-2">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-orange-600 text-white">
          <MessageSquareText className="h-4 w-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">Interview Prep</h3>
          <p className="text-xs text-slate-500">Grounded in the current job, resume, and company context.</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {sections.map((section) => (
          <SectionCard key={section.title} section={section} />
        ))}
      </div>
    </div>
  )
}
