"use client"

import { Sparkles } from "lucide-react"

// ── Skeleton card ────────────────────────────────────────────────────────────

function JobCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm opacity-0 animate-[scout-card-in_0.4s_ease-out_forwards]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="animate-pulse">
        {/* Title + score */}
        <div className="mb-2.5 flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="h-4 w-48 rounded-md bg-slate-100" />
            <div className="h-3 w-28 rounded-md bg-slate-100" />
          </div>
          <div className="h-6 w-12 flex-shrink-0 rounded-full bg-slate-100" />
        </div>
        {/* Meta row */}
        <div className="mb-3 flex gap-3">
          <div className="h-3 w-20 rounded-md bg-slate-100" />
          <div className="h-3 w-24 rounded-md bg-slate-100" />
        </div>
        {/* Action buttons */}
        <div className="flex gap-2">
          <div className="h-7 w-20 rounded-full bg-slate-100" />
          <div className="h-7 w-16 rounded-full bg-slate-100" />
        </div>
      </div>
    </div>
  )
}

// ── Mode captions ────────────────────────────────────────────────────────────

const MODE_CAPTION: Record<string, string> = {
  search:           "Scanning jobs for you",
  compare:          "Ranking your saved jobs",
  tailor:           "Tailoring your resume",
  research:         "Deep-researching",
  career_strategy:  "Building your strategy",
  outreach:         "Drafting outreach",
  interview:        "Preparing interview content",
  applications:     "Reviewing your applications",
  bulk_application: "Queuing applications",
  company:          "Researching this company",
}

// ── Component ────────────────────────────────────────────────────────────────

type Props = {
  workspaceMode: string
  lastUserMessage?: string
  narrative?: string
}

export function ScoutThinkingCanvas({ workspaceMode, lastUserMessage, narrative }: Props) {
  const caption = narrative || MODE_CAPTION[workspaceMode] || "Working"

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">

      {/* User message echo — right-aligned */}
      {lastUserMessage && (
        <div className="flex items-end justify-end gap-2.5">
          <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-slate-900 px-4 py-3 text-sm leading-relaxed text-white shadow-sm">
            {lastUserMessage}
          </div>
        </div>
      )}

      {/* Scout thinking bubble */}
      <div className="flex items-start gap-3">
        <span className="relative mt-0.5 flex-shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.40)]">
          <span className="absolute inset-0 animate-ping rounded-xl bg-[#FF5C18] opacity-25" />
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </span>
        <div className="rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-medium text-slate-500">{caption}</span>
            <span className="flex items-center gap-1">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]/50 animate-bounce"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </span>
          </div>
        </div>
      </div>

      {/* Skeleton job cards */}
      <div className="space-y-3">
        <JobCardSkeleton delay={60} />
        <JobCardSkeleton delay={140} />
        <JobCardSkeleton delay={220} />
      </div>
    </div>
  )
}
