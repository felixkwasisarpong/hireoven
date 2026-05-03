"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { Brain, Building2, Clock, Globe, Layers, Shield, Workflow as WorkflowIcon, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ScoutTimelineEvent, ScoutTimelineReplayAction } from "@/lib/scout/timeline/types"
import type { CompanyIntel, CompanyIntelSummary } from "@/lib/scout/company-intel/types"
import type { ScoutPermissionState } from "@/lib/scout/permissions"
import type { ScoutProactiveEvent, ScoutProactiveEventType } from "@/lib/scout/proactive/types"
import type { MarketSignal } from "@/lib/scout/market-intelligence"
import type { ActiveBrowserContext } from "@/lib/scout/browser-context"
import type { ScoutActiveWorkflow } from "@/lib/scout/workflows/types"

const ScoutTimelinePanel  = dynamic(() => import("@/components/scout/timeline/ScoutTimelinePanel").then((m) => ({ default: m.ScoutTimelinePanel })),  { ssr: false })
const CompanyIntelRail    = dynamic(() => import("@/components/scout/CompanyIntelRail").then((m) => ({ default: m.CompanyIntelRail })),               { ssr: false })
const BrowserContextRail  = dynamic(() => import("@/components/scout/workspace/BrowserContextRail").then((m) => ({ default: m.BrowserContextRail })), { ssr: false })
const ScoutProactiveRail  = dynamic(() => import("@/components/scout/proactive/ScoutProactiveRail").then((m) => ({ default: m.ScoutProactiveRail })), { ssr: false })
const ScoutMarketRail     = dynamic(() => import("@/components/scout/ScoutMarketRail").then((m) => ({ default: m.ScoutMarketRail })),                  { ssr: false })

export type ContextPanelTab =
  | "timeline"
  | "context"
  | "workflow"
  | "memory"
  | "permissions"

type Props = {
  open: boolean
  tab: ContextPanelTab
  onTabChange: (t: ContextPanelTab) => void
  onClose: () => void

  // Timeline
  timelineEvents:   ScoutTimelineEvent[]
  onClearTimeline:  () => void
  onReplay:         (a: ScoutTimelineReplayAction) => void
  isDev:            boolean

  // Context: company intel
  companyId?:       string
  companyName?:     string
  companyIntel?:    CompanyIntel | null
  companySummary?:  CompanyIntelSummary | null
  companyLoading?:  boolean
  onCloseCompany?:  () => void

  // Context: browser
  browserContext?:  ActiveBrowserContext | null
  activeWorkflow?:  ScoutActiveWorkflow | null
  latestRailEvents?: ScoutTimelineEvent[]
  proactiveRailEvents?: ScoutProactiveEvent[]
  onPreFill?:       (q: string) => void
  onExpandWorkflow?: () => void
  onOpenProactive?: (e: ScoutProactiveEvent) => void

  // Context: proactive (when no company / no browser context)
  proactiveEvents?: ScoutProactiveEvent[]
  proactiveEnabled?: boolean
  proactiveMutedCount?: number
  proactiveLoading?: boolean
  onDismissProactive?: (id: string) => void
  onSnoozeProactive?: (id: string) => void
  onMuteProactiveType?: (type: ScoutProactiveEventType) => void
  onClearMutedTypes?: () => void
  onSetProactiveEnabled?: (enabled: boolean) => void

  // Context: market
  marketSignals?:   MarketSignal[]
  marketLoading?:   boolean

  // Workflow
  workflowState?:   ScoutActiveWorkflow | null
  onContinueStep?:  () => void
  onSkipStep?:      () => void
  onPauseWorkflow?: () => void
  onResumeWorkflow?: () => void
  onCancelWorkflow?: () => void

  // Memory / Permissions — open the existing dedicated panels
  onOpenMemory?:       () => void
  onOpenPermissions?:  () => void
  permissions?:        ScoutPermissionState[]
}

const TABS: Array<{ value: ContextPanelTab; label: string; Icon: typeof Clock }> = [
  { value: "context",     label: "Context",     Icon: Layers      },
  { value: "timeline",    label: "Timeline",    Icon: Clock       },
  { value: "workflow",    label: "Workflow",    Icon: WorkflowIcon },
  { value: "memory",      label: "Memory",      Icon: Brain       },
  { value: "permissions", label: "Permissions", Icon: Shield      },
]

export function ScoutContextPanel(props: Props) {
  const {
    open, tab, onTabChange, onClose,
    timelineEvents, onClearTimeline, onReplay, isDev,
    companyId, companyName, companyIntel, companySummary, companyLoading, onCloseCompany,
    browserContext, activeWorkflow, latestRailEvents = [], proactiveRailEvents = [],
    onPreFill, onExpandWorkflow, onOpenProactive,
    proactiveEvents = [], proactiveEnabled = true, proactiveMutedCount = 0, proactiveLoading,
    onDismissProactive, onSnoozeProactive, onMuteProactiveType, onClearMutedTypes, onSetProactiveEnabled,
    marketSignals = [], marketLoading,
    workflowState,
    onOpenMemory, onOpenPermissions, permissions = [],
  } = props

  // Mount once we open so animations work; keep mounted briefly after close for slide-out
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    const t = window.setTimeout(() => setMounted(false), 200)
    return () => window.clearTimeout(t)
  }, [open])

  // Esc closes
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!mounted && !open) return null

  return (
    <>
      {/* Overlay (mobile only) */}
      <button
        type="button"
        aria-label="Close panel"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      {/* Panel */}
      <aside
        role="complementary"
        aria-label="Scout context"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[min(420px,100vw)] flex-col border-l border-slate-200 bg-white/95 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)] backdrop-blur-md transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Scout context
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 items-center gap-0.5 border-b border-slate-100 bg-slate-50/60 px-2 py-2">
          {TABS.map(({ value, label, Icon }) => {
            const active = tab === value
            return (
              <button
                key={value}
                type="button"
                onClick={() => onTabChange(value)}
                aria-pressed={active}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold transition",
                  active
                    ? "bg-white text-slate-900 shadow-[0_1px_4px_rgba(15,23,42,0.08)] ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-800"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {tab === "timeline" && (
            <div className="-mx-3">
              <ScoutTimelinePanel
                events={timelineEvents}
                onClose={onClose}
                onReplay={onReplay}
                onClear={onClearTimeline}
                isDev={isDev}
              />
            </div>
          )}

          {tab === "context" && (
            <div className="space-y-3">
              {/* Priority: company intel > browser context > proactive + market */}
              {(companyIntel || companyLoading) && companyId ? (
                <CompanyIntelRail
                  companyId={companyId}
                  companyName={companyName ?? "Company"}
                  intel={companyIntel ?? null}
                  summary={companySummary ?? null}
                  loading={Boolean(companyLoading)}
                  onClose={onCloseCompany ?? (() => {})}
                />
              ) : browserContext && browserContext.pageType !== "unknown" ? (
                <BrowserContextRail
                  context={browserContext}
                  activeWorkflow={activeWorkflow ?? null}
                  latestEvents={latestRailEvents}
                  proactiveEvents={proactiveRailEvents}
                  onPreFill={onPreFill ?? (() => {})}
                  onExpandWorkflow={onExpandWorkflow ?? (() => {})}
                  onOpenProactive={onOpenProactive ?? (() => {})}
                />
              ) : (
                <ContextEmpty />
              )}

              {(proactiveEvents.length > 0 || proactiveLoading) && (
                <ScoutProactiveRail
                  events={proactiveEvents}
                  enabled={proactiveEnabled}
                  mutedCount={proactiveMutedCount}
                  loading={Boolean(proactiveLoading)}
                  onOpen={onOpenProactive ?? (() => {})}
                  onDismiss={onDismissProactive ?? (() => {})}
                  onSnooze={onSnoozeProactive ?? (() => {})}
                  onMuteType={onMuteProactiveType ?? (() => {})}
                  onClearMutedTypes={onClearMutedTypes ?? (() => {})}
                  onSetEnabled={onSetProactiveEnabled ?? (() => {})}
                />
              )}

              {(marketSignals.length > 0 || marketLoading) && (
                <ScoutMarketRail signals={marketSignals} loading={Boolean(marketLoading)} />
              )}
            </div>
          )}

          {tab === "workflow" && (
            <WorkflowSummary
              state={workflowState ?? null}
              onContinue={props.onContinueStep}
              onSkip={props.onSkipStep}
              onPause={props.onPauseWorkflow}
              onResume={props.onResumeWorkflow}
              onCancel={props.onCancelWorkflow}
            />
          )}

          {tab === "memory" && (
            <PanelLink
              icon={Brain}
              title="Scout memory"
              body="Manage your search profile, learned signals, and personalisation chips."
              ctaLabel="Open memory panel"
              onClick={onOpenMemory ?? (() => {})}
            />
          )}

          {tab === "permissions" && (
            <PanelLink
              icon={Shield}
              title="Scout permissions"
              body={`${permissions.length} permission${permissions.length === 1 ? "" : "s"} on record. Decide what Scout can do automatically.`}
              ctaLabel="Open permissions panel"
              onClick={onOpenPermissions ?? (() => {})}
            />
          )}
        </div>
      </aside>
    </>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

function ContextEmpty() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-5 text-center">
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200">
        <Globe className="h-4 w-4 text-slate-400" aria-hidden />
      </div>
      <p className="text-[13.5px] font-semibold text-slate-700">No active context</p>
      <p className="mt-1 text-[12px] text-slate-500">
        Open a job, company, or active tab via the extension and Scout&apos;s relevant intel will appear here.
      </p>
    </div>
  )
}

function PanelLink({
  icon: Icon, title, body, ctaLabel, onClick,
}: {
  icon: typeof Brain
  title: string
  body: string
  ctaLabel: string
  onClick: () => void
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200">
        <Icon className="h-4 w-4 text-slate-600" aria-hidden />
      </div>
      <p className="text-[14px] font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{body}</p>
      <button
        type="button"
        onClick={onClick}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white shadow-[0_2px_8px_rgba(15,23,42,0.18)] transition hover:bg-slate-800"
      >
        {ctaLabel}
      </button>
    </div>
  )
}

function WorkflowSummary({
  state, onContinue, onSkip, onPause, onResume, onCancel,
}: {
  state: ScoutActiveWorkflow | null
  onContinue?: () => void
  onSkip?: () => void
  onPause?: () => void
  onResume?: () => void
  onCancel?: () => void
}) {
  if (!state) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-5 text-center">
        <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200">
          <Building2 className="h-4 w-4 text-slate-400" aria-hidden />
        </div>
        <p className="text-[13.5px] font-semibold text-slate-700">No active workflow</p>
        <p className="mt-1 text-[12px] text-slate-500">
          Workflows you start with Scout appear here so you can step through, pause, or resume.
        </p>
      </div>
    )
  }

  const stepIdx = state.steps.findIndex((s) => s.id === state.activeStepId)
  const stepNum = stepIdx >= 0 ? stepIdx + 1 : 1
  const total   = state.steps.length

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#FF5C18]">
        Active workflow
      </p>
      <p className="mt-1 text-[14px] font-semibold text-slate-900">{state.title}</p>
      <p className="mt-0.5 text-[12px] text-slate-500">
        Step {stepNum} of {total}
      </p>

      <ol className="mt-3 space-y-1.5">
        {state.steps.map((s, i) => {
          const done = i < stepIdx
          const active = i === stepIdx
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12.5px]",
                active
                  ? "border-[#FFD5C2] bg-[#FFF8F5] text-[#FF5C18]"
                  : done
                    ? "border-slate-100 bg-slate-50 text-slate-400 line-through"
                    : "border-slate-100 bg-white text-slate-600"
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                  active ? "bg-[#FF5C18] text-white" : done ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"
                )}
              >
                {i + 1}
              </span>
              <span className="truncate">{s.title}</span>
            </li>
          )
        })}
      </ol>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {onContinue && (
          <button type="button" onClick={onContinue} className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-slate-800">
            Continue
          </button>
        )}
        {onSkip && (
          <button type="button" onClick={onSkip} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50">
            Skip
          </button>
        )}
        {!state.pausedAt && !state.completedAt && !state.cancelledAt && onPause && (
          <button type="button" onClick={onPause} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50">
            Pause
          </button>
        )}
        {state.pausedAt && !state.completedAt && !state.cancelledAt && onResume && (
          <button type="button" onClick={onResume} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50">
            Resume
          </button>
        )}
        {onCancel && !state.completedAt && !state.cancelledAt && (
          <button type="button" onClick={onCancel} className="ml-auto rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[12px] font-medium text-rose-700 transition hover:bg-rose-100">
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
