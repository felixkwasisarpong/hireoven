"use client"

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  FileText,
  MessageSquare,
  ShieldAlert,
  XCircle,
  Zap,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ApplicationReviewChecklist } from "@/lib/scout/review/types"

const READINESS_CONFIG = {
  ready:        { label: "Ready to apply",  bg: "bg-emerald-50",  border: "border-emerald-200", text: "text-emerald-700", icon: CheckCircle2 },
  needs_review: { label: "Needs review",    bg: "bg-amber-50",    border: "border-amber-200",   text: "text-amber-700",   icon: AlertTriangle },
  blocked:      { label: "Blocked",         bg: "bg-red-50",      border: "border-red-200",     text: "text-red-700",     icon: XCircle },
}

function CheckRow({
  icon: Icon,
  label,
  ready,
  note,
}: {
  icon: React.ElementType
  label: string
  ready: boolean
  note?: string
}) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <Icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", ready ? "text-emerald-500" : "text-slate-300")} />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", ready ? "text-slate-800" : "text-slate-400")}>{label}</p>
        {note && <p className="mt-0.5 text-xs text-slate-400">{note}</p>}
      </div>
      {ready
        ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />
        : <Circle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-200" />
      }
    </div>
  )
}

type Props = {
  checklist: ApplicationReviewChecklist
  compact?:  boolean
}

export function ReviewChecklist({ checklist, compact = false }: Props) {
  const cfg = READINESS_CONFIG[checklist.submitReadiness]
  const ReadinessIcon = cfg.icon

  return (
    <div className="space-y-4">

      {/* Readiness badge */}
      <div className={cn("flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5", cfg.bg, cfg.border)}>
        <ReadinessIcon className={cn("h-4 w-4 flex-shrink-0", cfg.text)} />
        <p className={cn("text-sm font-semibold", cfg.text)}>{cfg.label}</p>
      </div>

      {/* Blockers */}
      {checklist.blockers.length > 0 && (
        <ul className="space-y-1.5">
          {checklist.blockers.map((b, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-xs text-red-700">
              <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="leading-5">{b}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Warnings */}
      {checklist.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {checklist.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="leading-5">{w}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Checklist rows */}
      {!compact && (
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
          <div className="px-4">
            <CheckRow
              icon={FileText}
              label="Tailored resume"
              ready={checklist.resumeReady}
              note={checklist.resumeReady ? undefined : "Not tailored — base resume will be used"}
            />
          </div>
          <div className="px-4">
            <CheckRow
              icon={MessageSquare}
              label="Cover letter"
              ready={checklist.coverLetterReady}
              note={checklist.coverLetterReady ? undefined : "Optional — you can apply without one"}
            />
          </div>
          <div className="px-4">
            <CheckRow
              icon={Zap}
              label="Autofill profile"
              ready={checklist.autofillReady}
              note={checklist.autofillReady ? undefined : "Complete your autofill profile first"}
            />
          </div>
          <div className="px-4">
            <CheckRow
              icon={ShieldAlert}
              label="Sensitive fields reviewed"
              ready={checklist.sensitiveFieldsReviewed}
              note="Sponsorship / legal / EEO questions — fill these manually on the form"
            />
          </div>
        </div>
      )}

      {/* Hard safety reminder */}
      <div className="flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-3">
        <Ban className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        <p className="text-[11px] leading-5 text-slate-500">
          Review the application carefully, then{" "}
          <span className="font-semibold text-slate-700">submit manually on the site.</span>{" "}
          Scout never clicks submit.
        </p>
      </div>
    </div>
  )
}
