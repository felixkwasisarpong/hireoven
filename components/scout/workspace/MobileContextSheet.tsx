"use client"

import { BarChart2, Clock3, FileText, ListTodo, Sparkles, X, Zap } from "lucide-react"
import type { ActiveBrowserContext } from "@/lib/scout/browser-context"
import type { ScoutActiveWorkflow } from "@/lib/scout/workflows/types"
import type { ScoutTimelineEvent } from "@/lib/scout/timeline/types"
import type { ScoutProactiveEvent } from "@/lib/scout/proactive/types"

type Props = {
  open: boolean
  onClose: () => void
  browserContext: ActiveBrowserContext | null
  activeWorkflow: ScoutActiveWorkflow | null
  latestEvents: ScoutTimelineEvent[]
  proactiveEvents: ScoutProactiveEvent[]
  onOpenProactive: (event: ScoutProactiveEvent) => void
  onExpandWorkflow: () => void
  onPreFill: (query: string) => void
  onOpenTimeline: () => void
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
}

export function MobileContextSheet({
  open,
  onClose,
  browserContext,
  activeWorkflow,
  latestEvents,
  proactiveEvents,
  onOpenProactive,
  onExpandWorkflow,
  onPreFill,
  onOpenTimeline,
}: Props) {
  if (!open) return null

  const activeStep = activeWorkflow?.steps.find((s) => s.status === "running" || s.status === "waiting_user")

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close Scout context"
        onClick={onClose}
        className="absolute inset-0 bg-black/25"
      />

      <div className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-[0_-12px_36px_rgba(15,23,42,0.25)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold text-slate-900">Scout context</p>
            <p className="text-[11px] text-slate-500">Latest activity and browser awareness</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
            <div className="min-w-[84%] snap-start rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Workflow</p>
              {activeWorkflow && activeStep ? (
                <>
                  <p className="text-sm font-semibold text-slate-900">{activeWorkflow.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {activeStep.status === "waiting_user" ? "Awaiting review" : "In progress"} · {activeStep.title}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onExpandWorkflow()
                      onClose()
                    }}
                    className="mt-2 rounded-full border border-[#FF5C18]/25 bg-[#FF5C18]/7 px-3 py-1 text-[11px] font-semibold text-[#FF5C18]"
                  >
                    Open workflow
                  </button>
                </>
              ) : (
                <p className="text-xs text-slate-500">No active workflow right now.</p>
              )}
            </div>

            <div className="min-w-[84%] snap-start rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Latest actions</p>
                <button
                  type="button"
                  onClick={() => {
                    onOpenTimeline()
                    onClose()
                  }}
                  className="text-[10px] font-semibold text-[#FF5C18]"
                >
                  View timeline
                </button>
              </div>
              <div className="space-y-1.5">
                {latestEvents.slice(0, 4).map((event) => (
                  <div key={event.id} className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
                    <p className="text-xs font-medium text-slate-700">{event.title}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {event.type.replace(/_/g, " ")}
                      {shortTime(event.timestamp) ? ` · ${shortTime(event.timestamp)}` : ""}
                    </p>
                  </div>
                ))}
                {latestEvents.length === 0 && (
                  <p className="text-xs text-slate-500">No recent Scout actions.</p>
                )}
              </div>
            </div>

            <div className="min-w-[84%] snap-start rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Active browser</p>
              {browserContext && browserContext.pageType !== "unknown" ? (
                <>
                  <p className="text-sm font-semibold text-slate-900 line-clamp-2">{browserContext.title ?? "Active tab context"}</p>
                  {browserContext.company && (
                    <p className="text-xs text-slate-500">{browserContext.company}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {browserContext.pageType === "job_detail" && (
                      <button
                        type="button"
                        onClick={() => {
                          onPreFill(browserContext.company
                            ? `Tailor my resume for ${browserContext.company}`
                            : "Tailor my resume for this role")
                          onClose()
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700"
                      >
                        <FileText className="h-3 w-3" /> Tailor
                      </button>
                    )}
                    {browserContext.pageType === "application_form" && (
                      <button
                        type="button"
                        onClick={() => {
                          onPreFill("Review autofill fields before applying")
                          onClose()
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700"
                      >
                        <Zap className="h-3 w-3" /> Review autofill
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onPreFill(browserContext.company
                          ? `Compare ${browserContext.company} with my saved jobs`
                          : "Compare this role with my saved jobs")
                        onClose()
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600"
                    >
                      <BarChart2 className="h-3 w-3" /> Compare
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-500">Open a job or application page to bring browser context here.</p>
              )}
            </div>

            <div className="min-w-[84%] snap-start rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">Proactive Scout</p>
              <div className="space-y-1.5">
                {proactiveEvents.slice(0, 3).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => {
                      onOpenProactive(event)
                      onClose()
                    }}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left"
                  >
                    <p className="text-xs font-medium text-slate-700">{event.title}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{event.summary}</p>
                  </button>
                ))}
                {proactiveEvents.length === 0 && (
                  <p className="text-xs text-slate-500">No proactive suggestions right now.</p>
                )}
              </div>
            </div>
          </div>

          <p className="mt-2 flex items-center gap-1.5 px-1 text-[10px] text-slate-400">
            <Sparkles className="h-3 w-3" />
            Swipe cards to review workflow, actions, browser context, and proactive signals.
          </p>
        </div>
      </div>
    </div>
  )
}
