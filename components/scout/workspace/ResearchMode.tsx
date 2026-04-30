"use client"

import {
  AlertCircle,
  ArrowUpRight,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronRight,
  Circle,
  Globe,
  Loader2,
  TrendingUp,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutResearchTask, ScoutResearchFinding, ScoutResearchStep } from "@/lib/scout/research/types"

// ── Finding type metadata ─────────────────────────────────────────────────────

const FINDING_META: Record<
  ScoutResearchFinding["type"],
  { icon: React.ElementType; label: string; accent: string; bg: string }
> = {
  job_cluster:         { icon: Briefcase,    label: "Job Cluster",          accent: "text-blue-600",   bg: "bg-blue-50 border-blue-100"   },
  company_pattern:     { icon: Building2,    label: "Company Pattern",      accent: "text-violet-600", bg: "bg-violet-50 border-violet-100" },
  skill_gap:           { icon: AlertCircle,  label: "Skill Gap",            accent: "text-amber-600",  bg: "bg-amber-50 border-amber-100"  },
  market_signal:       { icon: TrendingUp,   label: "Market Signal",        accent: "text-emerald-600",bg: "bg-emerald-50 border-emerald-100" },
  sponsorship_pattern: { icon: Globe,        label: "Sponsorship Pattern",  accent: "text-[#FF5C18]",  bg: "bg-orange-50 border-orange-100" },
  career_path:         { icon: ArrowUpRight, label: "Career Path",          accent: "text-sky-600",    bg: "bg-sky-50 border-sky-100"      },
}

// ── Confidence label ──────────────────────────────────────────────────────────

function confidenceLabel(conf?: number): { label: string; cls: string } {
  if (!conf) return { label: "Unknown",  cls: "text-gray-400" }
  if (conf >= 0.75) return { label: "High",   cls: "text-emerald-600" }
  if (conf >= 0.55) return { label: "Medium", cls: "text-amber-600"   }
  return               { label: "Low",    cls: "text-red-500"    }
}

// ── Step row ──────────────────────────────────────────────────────────────────

function StepRow({ step, index }: { step: ScoutResearchStep; index: number }) {
  const isRunning   = step.status === "running"
  const isCompleted = step.status === "completed"
  const isFailed    = step.status === "failed"
  const isPending   = step.status === "pending"

  return (
    <div className={cn(
      "flex items-start gap-3 py-2.5 transition-all duration-200",
      isPending && "opacity-40",
    )}>
      <div className="mt-0.5 flex-shrink-0">
        {isRunning   && <Loader2  className="h-4 w-4 animate-spin text-[#FF5C18]" />}
        {isCompleted && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        {isFailed    && <XCircle  className="h-4 w-4 text-red-400" />}
        {isPending   && <Circle   className="h-4 w-4 text-slate-300" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn(
          "text-sm font-medium leading-none",
          isCompleted ? "text-slate-700" : isRunning ? "text-slate-900" : "text-slate-400",
        )}>
          {step.title}
        </p>
        {step.summary && isCompleted && (
          <p className="mt-0.5 text-[11px] text-slate-400">{step.summary}</p>
        )}
        {isRunning && (
          <p className="mt-0.5 text-[11px] text-[#FF5C18]/70 animate-pulse">Running…</p>
        )}
      </div>
      {step.durationMs !== undefined && isCompleted && (
        <span className="flex-shrink-0 text-[10px] text-slate-300">{step.durationMs}ms</span>
      )}
    </div>
  )
}

// ── Finding card ──────────────────────────────────────────────────────────────

function FindingCard({
  finding,
  onCommand,
}: {
  finding:   ScoutResearchFinding
  onCommand: (cmd: string) => void
}) {
  const meta = FINDING_META[finding.type]
  const Icon = meta.icon
  const conf = confidenceLabel(finding.confidence)

  return (
    <div className={cn("rounded-xl border p-4 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2", meta.bg)}>
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 flex-shrink-0", meta.accent)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-semibold uppercase tracking-wider", meta.accent)}>
              {meta.label}
            </span>
            <span className={cn("text-[10px] font-medium", conf.cls)}>
              {conf.label} confidence
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-800 leading-snug">{finding.title}</p>
        </div>
      </div>

      {/* Summary */}
      <p className="mt-2 text-sm text-slate-600 leading-relaxed">{finding.summary}</p>

      {/* Evidence pills */}
      {finding.evidence && finding.evidence.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {finding.evidence.map((e, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md bg-white/70 border border-white/50 px-2 py-0.5 text-[10px] text-slate-500"
            >
              {e}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {finding.actions && finding.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {finding.actions.map((action, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onCommand(action.command)}
              className="inline-flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 active:scale-95"
            >
              {action.label}
              <ChevronRight className="h-3 w-3 text-slate-400" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ task }: { task: ScoutResearchTask }) {
  const completedSteps = task.steps.filter((s) => s.status === "completed").length
  const total          = task.steps.length
  const isRunning      = task.status === "running"
  const isDone         = task.status === "completed"
  const isFailed       = task.status === "failed"

  if (isFailed) return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 border border-red-100 px-2.5 py-1 text-[10px] font-medium text-red-500">
      <XCircle className="h-3 w-3" />
      Failed
    </span>
  )
  if (isDone) return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-100 px-2.5 py-1 text-[10px] font-medium text-emerald-600">
      <CheckCircle2 className="h-3 w-3" />
      Complete
    </span>
  )
  if (isRunning) return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 border border-orange-100 px-2.5 py-1 text-[10px] font-medium text-[#FF5C18]">
      <Loader2 className="h-3 w-3 animate-spin" />
      {completedSteps}/{total} steps
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-500">
      Queued
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  task:      ScoutResearchTask | null
  isRunning: boolean
  onCommand: (cmd: string) => void
}

export function ResearchMode({ task, isRunning, onCommand }: Props) {
  // Loading state — task not yet received from server
  if (!task) {
    return (
      <div className="flex items-center gap-3 py-10 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin text-[#FF5C18]" />
        <span className="text-sm">Initialising research…</span>
      </div>
    )
  }

  const findings = task.findings ?? []

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Research</p>
            <h2 className="mt-0.5 text-lg font-bold text-slate-900 leading-tight">{task.title}</h2>
          </div>
          <StatusBadge task={task} />
        </div>
        <p className="mt-1.5 text-sm text-slate-500 italic">"{task.objective}"</p>
      </div>

      {/* ── Step progress ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 space-y-0.5 shadow-sm">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Steps</p>
        {task.steps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i} />
        ))}
      </div>

      {/* ── Findings ─────────────────────────────────────────────────────────── */}
      {findings.length > 0 && (
        <div>
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Findings {task.status === "running" ? "— streaming…" : `(${findings.length})`}
          </p>
          <div className="space-y-3">
            {findings.map((finding, i) => (
              <FindingCard key={i} finding={finding} onCommand={onCommand} />
            ))}
          </div>
        </div>
      )}

      {/* ── Empty state during synthesis ─────────────────────────────────────── */}
      {findings.length === 0 && task.status === "running" && task.steps.find((s) => s.id === "s5" && s.status === "running") && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 px-4 py-5 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-[#FF5C18]/70 flex-shrink-0" />
          <p className="text-sm">Synthesising findings from gathered data…</p>
        </div>
      )}

      {/* ── Failed state ─────────────────────────────────────────────────────── */}
      {task.status === "failed" && findings.length === 0 && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-4 text-sm text-red-600">
          Research could not produce findings. Try a more specific query, or ensure you have saved jobs to analyse.
        </div>
      )}

      {/* ── Follow-up chips (completed state) ────────────────────────────────── */}
      {task.status === "completed" && task.followUpCommands && task.followUpCommands.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">What next?</p>
          <div className="flex flex-wrap gap-2">
            {task.followUpCommands.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => onCommand(cmd)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 active:scale-95"
              >
                {cmd}
                <ChevronRight className="h-3 w-3 text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
