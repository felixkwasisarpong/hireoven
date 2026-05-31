"use client"

import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Command,
  FileCheck,
  FileText,
  Filter,
  Layers3,
  MousePointerClick,
  PlayCircle,
  Route,
  Shield,
  Sparkles,
  Target,
  Zap,
} from "lucide-react"

import { ScoutActionRenderer } from "@/components/scout/ScoutActionRenderer"
import { ScoutWorkflowRenderer } from "@/components/scout/ScoutWorkflowRenderer"
import type { ScoutAction, ScoutWorkflow } from "@/lib/scout/types"

const QUICK_COMMANDS = [
  {
    icon: Filter,
    title: "Focus my feed",
    description: "Apply filters and reduce noisy jobs.",
    chip: "Focus my feed on jobs worth my time",
  },
  {
    icon: FileText,
    title: "Prepare to apply",
    description: "Build a step-by-step application workflow.",
    chip: "Help me prepare to apply",
  },
  {
    icon: Target,
    title: "Fix my chances",
    description: "Find resume gaps blocking better matches.",
    chip: "What should I fix before applying?",
  },
]

const ACTION_CAPABILITIES = [
  {
    icon: Filter,
    title: "Apply filters",
    description: "Scout can reshape the feed with validated filters.",
    status: "Live",
  },
  {
    icon: Route,
    title: "Guided workflows",
    description: "Turn messy tasks into short, clickable steps.",
    status: "Live",
  },
  {
    icon: Shield,
    title: "Safe execution",
    description: "No destructive changes. Every action is validated first.",
    status: "Protected",
  },
  {
    icon: MousePointerClick,
    title: "User approved",
    description: "Scout suggests. You click before anything runs.",
    status: "Controlled",
  },
]

function EmptyExecutionState({ onFillChip }: { onFillChip: (chip: string) => void }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-100 bg-orange-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-orange-700">
            <Command className="h-3.5 w-3.5" />
            Command ready
          </div>
          <h3 className="mt-4 text-xl font-bold tracking-tight text-slate-950">
            No active Scout action yet
          </h3>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Ask Scout for a command or workflow. When Scout finds something useful, actions will appear here as safe, clickable controls.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {QUICK_COMMANDS.map((command) => {
              const Icon = command.icon
              return (
                <button
                  key={command.title}
                  type="button"
                  onClick={() => onFillChip(command.chip)}
                  className="group rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50/70 hover:shadow-md"
                >
                  <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-orange-700 shadow-sm">
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="mt-3 text-sm font-bold text-slate-950">{command.title}</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">{command.description}</p>
                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-orange-600">
                    Try command
                    <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
            <Bot className="h-5 w-5" />
          </div>
          <p className="mt-4 text-sm font-bold text-slate-950">How this works</p>
          <ol className="mt-3 space-y-3 text-xs leading-5 text-slate-500">
            <li className="flex gap-2">
              <span className="font-bold text-slate-400">1.</span>
              Ask Scout what you want.
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-slate-400">2.</span>
              Scout returns validated actions.
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-slate-400">3.</span>
              You click to apply changes.
            </li>
          </ol>
        </div>
      </div>
    </section>
  )
}

function ActiveExecutionPanel({
  workflow,
  actions,
}: {
  workflow: ScoutWorkflow | null
  actions: ScoutAction[] | null
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">
            <PlayCircle className="h-3.5 w-3.5" />
            Ready to run
          </div>
          <h3 className="mt-3 text-xl font-bold tracking-tight text-slate-950">
            Scout prepared actions for you
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Review the steps and execute only the ones you want. Nothing runs automatically.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
          <Shield className="h-3.5 w-3.5 text-emerald-600" />
          Safe actions only
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
        <div className="space-y-4">
          {workflow && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Route className="h-4 w-4 text-orange-600" />
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Guided Workflow
                </p>
              </div>
              <ScoutWorkflowRenderer workflow={workflow} />
            </div>
          )}

          {actions && actions.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Suggested Actions
                </p>
              </div>
              <ScoutActionRenderer actions={actions} source="chat" />
            </div>
          )}
        </div>

        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Execution Rules
          </p>
          <div className="mt-4 space-y-3">
            {[
              "Scout cannot auto-apply to jobs.",
              "Scout cannot delete or hide saved data permanently.",
              "Every UI change must be clicked by you.",
            ].map((rule) => (
              <div key={rule} className="flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
                <p className="text-xs leading-5 text-slate-600">{rule}</p>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  )
}

function CapabilityGrid({ onFillChip }: { onFillChip: (chip: string) => void }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
            Action Library
          </p>
          <h3 className="mt-1 text-lg font-bold tracking-tight text-slate-950">
            What Scout can control
          </h3>
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-500">
          Validated UI actions
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {ACTION_CAPABILITIES.map((card) => {
          const Icon = card.icon
          return (
            <article
              key={card.title}
              className="group rounded-2xl border border-slate-200 bg-slate-50/60 p-4 transition hover:-translate-y-0.5 hover:border-orange-200 hover:bg-white hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-orange-700 shadow-sm">
                  <Icon className="h-4 w-4" />
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                  {card.status}
                </span>
              </div>
              <p className="mt-3 text-sm font-bold text-slate-950">{card.title}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{card.description}</p>
            </article>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {QUICK_COMMANDS.map((command) => (
          <button
            key={command.title}
            type="button"
            onClick={() => onFillChip(command.chip)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700"
          >
            {command.title}
            <ChevronRight className="h-3 w-3" />
          </button>
        ))}
      </div>
    </section>
  )
}

export type ScoutActionsTabProps = {
  lastWorkflowResponse: ScoutWorkflow | null
  lastActionsResponse: ScoutAction[] | null
  onFillChip: (chip: string) => void
}

export function ScoutActionsTab({
  lastWorkflowResponse,
  lastActionsResponse,
  onFillChip,
}: ScoutActionsTabProps) {
  const hasContent =
    lastWorkflowResponse !== null ||
    (lastActionsResponse !== null && lastActionsResponse.length > 0)

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-100 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-orange-700 shadow-sm">
            <Layers3 className="h-3.5 w-3.5" />
            Actions
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            Scout control center
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
            Workflows, commands, and safe UI actions Scout can prepare for your job search.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onFillChip("Focus my feed on jobs worth my time")}
          className="inline-flex items-center gap-2 rounded-2xl bg-orange-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-orange-700"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Start command
        </button>
      </section>

      {hasContent ? (
        <ActiveExecutionPanel workflow={lastWorkflowResponse} actions={lastActionsResponse} />
      ) : (
        <EmptyExecutionState onFillChip={onFillChip} />
      )}

      <CapabilityGrid onFillChip={onFillChip} />
    </div>
  )
}
