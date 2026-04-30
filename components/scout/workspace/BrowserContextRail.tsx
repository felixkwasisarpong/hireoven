"use client"

import { ArrowUpRight, FileText, MonitorSmartphone, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ActiveBrowserContext } from "@/lib/scout/browser-context"
import type { ScoutActiveWorkflow } from "@/lib/scout/workflows/types"

// ── ATS display names ──────────────────────────────────────────────────────────

const ATS_LABEL: Record<string, string> = {
  greenhouse:      "Greenhouse",
  lever:           "Lever",
  ashby:           "Ashby",
  workday:         "Workday",
  icims:           "iCIMS",
  smartrecruiters: "SmartRecruiters",
  bamboohr:        "BambooHR",
  linkedin:        "LinkedIn",
  glassdoor:       "Glassdoor",
}

// ── Page-mode badge style ──────────────────────────────────────────────────────

type PageModeStyleKey = "job_detail" | "application_form" | "search_results" | "company_page" | "unknown"

const PAGE_STYLE: Record<PageModeStyleKey, string> = {
  job_detail:       "bg-blue-50 text-blue-700",
  application_form: "bg-amber-50 text-amber-700",
  search_results:   "bg-violet-50 text-violet-700",
  company_page:     "bg-[#FF5C18]/8 text-[#c94010]",
  unknown:          "bg-slate-50 text-slate-500",
}

const PAGE_LABEL: Record<PageModeStyleKey, string> = {
  job_detail:       "Job detail",
  application_form: "Application form",
  search_results:   "Search results",
  company_page:     "Company page",
  unknown:          "Page",
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  context: ActiveBrowserContext
  /** Active running workflow (to show workflow status in rail) */
  activeWorkflow: ScoutActiveWorkflow | null
  /** Pre-fills the Scout command bar — user reviews before submitting */
  onPreFill: (query: string) => void
  /** Expand the floating workflow panel */
  onExpandWorkflow: () => void
}

export function BrowserContextRail({ context, activeWorkflow, onPreFill, onExpandWorkflow }: Props) {
  const pageStyle = PAGE_STYLE[context.pageType as PageModeStyleKey] ?? PAGE_STYLE.unknown
  const pageLabel = PAGE_LABEL[context.pageType as PageModeStyleKey] ?? PAGE_LABEL.unknown
  const atsLabel  = context.atsProvider ? (ATS_LABEL[context.atsProvider] ?? context.atsProvider) : null

  const isJob  = context.pageType === "job_detail"
  const isForm = context.pageType === "application_form"

  let hostname = ""
  try { hostname = new URL(context.url).hostname.replace(/^www\./, "") } catch {}

  const activeStep = activeWorkflow?.steps.find(
    (s) => s.status === "running" || s.status === "waiting_user"
  )

  return (
    <div className="flex w-72 flex-shrink-0 flex-col gap-3 xl:w-80">

      {/* ── Main context card ───────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]">

        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <MonitorSmartphone className="h-3.5 w-3.5 flex-shrink-0 text-[#FF5C18]" />
          <p className="text-[10.5px] font-semibold uppercase tracking-widest text-slate-400">
            Active browser tab
          </p>
        </div>

        <div className="px-4 py-3 space-y-3">

          {/* Job title + company */}
          {(context.title || context.company) && (
            <div>
              {context.title && (
                <p className="text-[13px] font-semibold leading-5 text-slate-900 line-clamp-2">
                  {context.title}
                </p>
              )}
              {context.company && (
                <p className="mt-0.5 text-[12px] text-slate-500">{context.company}</p>
              )}
              {context.location && (
                <p className="text-[11px] text-slate-400">{context.location}</p>
              )}
            </div>
          )}

          {/* Badges */}
          <div className="flex flex-wrap gap-1.5">
            {atsLabel && (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {atsLabel}
              </span>
            )}
            <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold", pageStyle)}>
              {pageLabel}
            </span>
            {context.autofillAvailable && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#FF5C18]/8 px-2 py-0.5 text-[10px] font-semibold text-[#FF5C18]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]" />
                Autofill ready
              </span>
            )}
          </div>

          {/* URL */}
          {hostname && (
            <a
              href={context.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-[#FF5C18]"
            >
              <span className="min-w-0 flex-1 truncate">{hostname}</span>
              <ArrowUpRight className="h-3 w-3 flex-shrink-0" />
            </a>
          )}
        </div>

        {/* ── Quick actions ─────────────────────────────────────────────── */}
        {(isJob || isForm) && (
          <div className="border-t border-slate-100 px-4 py-3 space-y-1.5">
            {isForm && (
              <button
                type="button"
                onClick={() => onPreFill("Review autofill fields before applying")}
                className="flex w-full items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800 transition hover:bg-amber-100"
              >
                <Zap className="h-3.5 w-3.5 flex-shrink-0" />
                Review autofill fields
              </button>
            )}
            {isJob && (
              <>
                <button
                  type="button"
                  onClick={() => onPreFill(
                    context.company
                      ? `Tailor my resume for ${context.company}`
                      : "Tailor my resume for this role"
                  )}
                  className="flex w-full items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700 transition hover:bg-blue-100"
                >
                  <FileText className="h-3.5 w-3.5 flex-shrink-0" />
                  Tailor resume
                </button>
                <button
                  type="button"
                  onClick={() => onPreFill(
                    context.company
                      ? `Compare ${context.company} with my saved jobs`
                      : "Compare this job with my saved jobs"
                  )}
                  className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  Compare with saved jobs
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Active workflow card ─────────────────────────────────────────── */}
      {activeWorkflow && activeStep && (
        <div className="overflow-hidden rounded-2xl border border-[#FF5C18]/20 bg-white shadow-[0_2px_12px_rgba(255,92,24,0.06)]">
          <div className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#FF5C18]">
                  Active workflow
                </p>
                <p className="mt-1 text-[12px] font-semibold text-slate-900 leading-5">
                  {activeWorkflow.title}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {activeStep.status === "waiting_user" ? "Waiting: " : "Running: "}
                  {activeStep.title}
                </p>
              </div>
              <span
                className={cn(
                  "mt-1 flex-shrink-0 h-2 w-2 rounded-full",
                  activeStep.status === "waiting_user" ? "bg-amber-400" : "bg-[#FF5C18] animate-pulse"
                )}
              />
            </div>
            <button
              type="button"
              onClick={onExpandWorkflow}
              className="mt-2.5 w-full rounded-xl border border-[#FF5C18]/20 px-3 py-1.5 text-[11px] font-semibold text-[#FF5C18] transition hover:bg-[#FF5C18]/6"
            >
              {activeStep.status === "waiting_user" ? "Continue step →" : "View all steps"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
