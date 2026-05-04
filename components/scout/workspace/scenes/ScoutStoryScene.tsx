"use client"

import { ScoutOrb } from "@/components/scout/ScoutOrb"
import { ScoutProgressSteps } from "./ScoutProgressSteps"
import { renderInlineMarkdown } from "@/lib/scout/inline-markdown"
import type { WorkspaceMode } from "@/lib/scout/workspace"

type Props = {
  /** The user's last command — shown as the spoken intent. */
  command?: string
  /** Optional Scout narrative — if absent we fall back to a calm generic line. */
  narrative?: string
  /** Mode Scout is morphing toward (drives the step labels). */
  mode?: WorkspaceMode
  /** Streamed scout text so we can show the early answer beneath the steps. */
  streamText?: string
}

const MODE_PLAN: Partial<Record<WorkspaceMode, string[]>> = {
  search:           ["Reading the request",      "Checking your profile + filters", "Loading the search workspace", "Ranking matches"],
  compare:          ["Reading the request",      "Loading saved roles",             "Building comparison",          "Highlighting the strongest fit"],
  tailor:           ["Reading the request",      "Loading your resume + target",    "Spotting tailoring wins",      "Opening the tailor workspace"],
  applications:     ["Reading the request",      "Loading your application plan",   "Picking the next move",        "Opening the workflow"],
  bulk_application: ["Reading the request",      "Selecting candidate jobs",        "Preparing the queue",          "Opening bulk apply"],
  company:          ["Reading the request",      "Pulling company intel",           "Summarising signals",          "Opening company view"],
  research:         ["Reading the request",      "Mapping research steps",          "Gathering findings",           "Composing answer"],
  outreach:         ["Reading the request",      "Drafting outreach",               "Tightening tone",              "Opening outreach"],
  interview:        ["Reading the request",      "Pulling interview signals",       "Sketching prep plan",          "Opening prep workspace"],
  career_strategy:  ["Reading the request",      "Reviewing career signals",        "Mapping directions",           "Opening strategy view"],
}

const DEFAULT_PLAN = [
  "Reading the request",
  "Checking your profile + context",
  "Picking the right workspace",
  "Loading the response",
]

export function ScoutStoryScene({ command, narrative, mode, streamText }: Props) {
  const steps = (mode && MODE_PLAN[mode]) ?? DEFAULT_PLAN
  const calmNarrative =
    narrative?.trim() ||
    "Got it — I'm turning that into a workspace."

  return (
    <section
      aria-live="polite"
      aria-label="Scout is preparing your workspace"
      className="mx-auto w-full max-w-2xl px-4 pt-6 sm:pt-10 motion-safe:animate-[scoutFadeUp_0.5s_ease-out_both]"
    >
      {/* User command echo */}
      {command && (
        <div className="mb-5 flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-slate-900 px-4 py-2.5 text-[14px] leading-relaxed text-white shadow-sm">
            {command}
          </div>
        </div>
      )}

      {/* Scout narrative card */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_18px_rgba(15,23,42,0.06)] sm:p-6">
        {/* Glow halo */}
        <div className="pointer-events-none absolute -top-12 -left-12 h-40 w-40 rounded-full bg-[#FF5C18]/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -right-12 h-44 w-44 rounded-full bg-amber-200/30 blur-3xl" />

        <div className="relative flex items-start gap-3">
          <ScoutOrb size="md" state="thinking" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#FF5C18]">Scout</p>
            <p className="mt-1 text-[15px] leading-relaxed text-slate-800">
              {renderInlineMarkdown(calmNarrative)}
            </p>

            {streamText && (
              <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-slate-500">
                {renderInlineMarkdown(streamText)}
              </p>
            )}
          </div>
        </div>

        {/* Progress steps */}
        <div className="relative mt-5 border-t border-slate-100 pt-5">
          <ScoutProgressSteps steps={steps} />
        </div>

        {/* Bottom shimmer */}
        <div className="relative mt-5 h-[2px] w-full overflow-hidden rounded-full bg-slate-100">
          <span className="absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-[#FF5C18] to-transparent motion-safe:animate-[scoutShimmer_1.6s_linear_infinite]" />
        </div>
      </div>
    </section>
  )
}
