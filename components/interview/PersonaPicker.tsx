"use client"

import { cn } from "@/lib/utils"

export type PersonaId =
  | "friendly_recruiter"
  | "skeptical_hm"
  | "senior_staff"
  | "founder"
  | "panel"

type PersonaOption = {
  id: PersonaId
  label: string
  description: string
  liveOnly?: boolean
}

const PERSONAS: PersonaOption[] = [
  {
    id: "friendly_recruiter",
    label: "Recruiter",
    description: '"Tell me about yourself." Career story, motivation, fit — no tech.',
  },
  {
    id: "skeptical_hm",
    label: "Skeptical Hiring Manager",
    description: 'Asks "so what?" Pushes for measured outcomes.',
  },
  {
    id: "senior_staff",
    label: "Senior Peer",
    description: "Domain expert in your field. Probes craft, tradeoffs, judgment.",
  },
  {
    id: "founder",
    label: "Founder",
    description: "Energetic, mission-driven, asks why this company.",
  },
  {
    id: "panel",
    label: "Panel",
    description: "Recruiter + Hiring Manager alternating. Higher pressure.",
    liveOnly: true,
  },
]

type Props = {
  value: PersonaId
  onChange: (v: PersonaId) => void
  /** Disable panel persona when not in live mode */
  interviewType: string
}

export default function PersonaPicker({ value, onChange, interviewType }: Props) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {PERSONAS.map((p) => {
        const disabled = p.liveOnly && interviewType !== "live"
        const selected = value === p.id
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(p.id)}
            title={disabled ? "Available in live mode only" : undefined}
            className={cn(
              "relative flex flex-col rounded-xl border p-3 text-left transition",
              selected
                ? "border-orange-300 bg-orange-50 ring-1 ring-orange-300"
                : "border-slate-200 bg-white hover:border-slate-300",
              disabled && "cursor-not-allowed opacity-40"
            )}
          >
            <span className="text-[13px] font-semibold text-slate-900">{p.label}</span>
            <span className="mt-0.5 text-[12px] leading-snug text-slate-500">{p.description}</span>
            {p.liveOnly && (
              <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Live only
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
