"use client"

import Link from "next/link"
import { ArrowRight, ArrowUpRight, FileText } from "lucide-react"
import type { ScoutResponse, ScoutAction } from "@/lib/scout/types"
import type { ActiveEntities } from "./ScoutWorkspaceShell"
import { getScoutDisplayText } from "@/lib/scout/display-text"

type Props = {
  response:      ScoutResponse
  onFollowUp:    (query: string) => void
  activeEntities?: ActiveEntities
}

function getReadableAnswer(answer: string): string {
  return getScoutDisplayText(answer)
}

const TAILOR_STEPS = [
  "Align bullet points to job description keywords",
  "Highlight skills and experience that match requirements",
  "Suggest additions for gaps Scout detected",
]

export function TailorMode({ response, onFollowUp, activeEntities }: Props) {
  // ── Resolve job context from workspace_directive payload (server-resolved) ──
  // The chat route now injects a full resolved-job payload into workspace_directive
  // whenever a tailor command is detected. Read it first; fall back to the
  // OPEN_RESUME_TAILOR action payload; last resort: activeEntities.
  const wdPayload = response.workspace_directive?.mode === "tailor"
    ? (response.workspace_directive.payload ?? {})
    : {}

  const tailorAction = response.actions?.find(
    (a): a is Extract<ScoutAction, { type: "OPEN_RESUME_TAILOR" }> =>
      a.type === "OPEN_RESUME_TAILOR"
  )

  const resolvedJobId =
    (wdPayload.jobId   as string | undefined) ??
    tailorAction?.payload?.jobId

  const resolvedTitle =
    (wdPayload.title   as string | undefined) ??
    tailorAction?.label ??
    activeEntities?.jobTitle

  const resolvedCompany =
    (wdPayload.company as string | undefined) ??
    activeEntities?.companyName

  const resolvedDetailUrl =
    (wdPayload.detailUrl as string | undefined) ??
    (resolvedJobId ? `/dashboard/jobs/${resolvedJobId}` : null)

  // Build the actual tailor URL — always carry the resolved jobId
  const tailorUrl = resolvedJobId
    ? `/dashboard/resume/tailor?jobId=${resolvedJobId}`
    : tailorAction?.payload?.resumeId
      ? `/dashboard/resume/tailor?resumeId=${tailorAction.payload.resumeId}`
      : "/dashboard/resume/tailor"

  const hasJobContext = Boolean(resolvedJobId || resolvedTitle || resolvedCompany)
  const answerText   = getReadableAnswer(response.answer)

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_240px]">

      {/* ── Left: tailoring action ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">

          <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-slate-950">
              <FileText className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">Resume tailoring</p>
              {hasJobContext && (
                <p className="truncate text-[11px] text-gray-400">
                  {resolvedTitle ?? ""}
                  {resolvedTitle && resolvedCompany ? " at " : ""}
                  {resolvedCompany ?? ""}
                </p>
              )}
            </div>
            {/* Link to job detail — consistent with what's being tailored for */}
            {resolvedDetailUrl && (
              <Link
                href={resolvedDetailUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="View job detail"
                className="flex-shrink-0 text-slate-400 transition hover:text-[#FF5C18]"
              >
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            )}
          </div>

          {/* No-job-context warning */}
          {!hasJobContext && (
            <div className="border-b border-amber-100 bg-amber-50 px-5 py-3">
              <p className="text-xs text-amber-700">
                No job selected. Open a job from your saved list first so Scout can tailor specifically for that role.
              </p>
            </div>
          )}

          <div className="px-5 py-4">
            <p className="mb-3 text-sm text-gray-700">
              Scout has a role-focused tailoring checklist ready.
            </p>

            <details className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 sm:hidden">
              <summary className="cursor-pointer text-xs font-semibold text-gray-700">
                Show tailoring checklist
              </summary>
              <ul className="mt-2 space-y-1.5 pl-4">
                {TAILOR_STEPS.map((step) => (
                  <li key={step} className="list-disc text-xs text-gray-600">{step}</li>
                ))}
              </ul>
            </details>

            <ul className="mb-5 hidden space-y-2.5 border-l-2 border-gray-100 pl-4 sm:block">
              {TAILOR_STEPS.map((step) => (
                <li key={step} className="text-sm text-gray-600">{step}</li>
              ))}
            </ul>

            <Link
              href={tailorUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Open Resume Studio
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Follow-up chips */}
        <div className="flex flex-wrap gap-2">
          {["What gaps should I fix?", "Which sections are weakest?", "Show me keywords"].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onFollowUp(chip)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: intelligence pane ───────────────────────────────────── */}
      <div className="hidden space-y-4 lg:block">
        {answerText && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Scout insight
            </p>
            <p className="text-xs leading-5 text-gray-600">{answerText}</p>
          </div>
        )}

        {hasJobContext && (
          <div className={answerText ? "border-t border-gray-100 pt-4" : ""}>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Target role
            </p>
            {resolvedTitle && (
              <p className="text-sm font-semibold text-gray-800">{resolvedTitle}</p>
            )}
            {resolvedCompany && (
              <p className="mt-0.5 text-xs text-gray-500">{resolvedCompany}</p>
            )}
            {resolvedDetailUrl && (
              <Link
                href={resolvedDetailUrl}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#FF5C18] hover:underline"
              >
                View job <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}

        <div className={hasJobContext || answerText ? "border-t border-gray-100 pt-4" : ""}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
            Process
          </p>
          <ol className="space-y-1.5">
            {["Review Scout's suggested edits", "Approve or adjust changes", "Save as new resume version"].map((s, i) => (
              <li key={s} className="flex items-start gap-2 text-xs text-gray-500">
                <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-500">
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
