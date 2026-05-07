"use client"

import { useState } from "react"
import dynamic from "next/dynamic"

// Lazy-load the scrubber to avoid loading Monaco on every debrief page
const CodeReplayScrubber = dynamic(
  () => import("@/components/interview/CodeReplayScrubber"),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-xl bg-slate-100" /> }
)

type CodingFeedback = {
  correctness_pct: number
  code_quality: string
  complexity_awareness: string
  communication: string
  time_used_pct: number
  biggest_lesson: string
}

type Props = {
  feedback: CodingFeedback
  sessionId: string
  language?: string
  snapshotCount?: number
}

export default function DebriefCodingPanel({ feedback, sessionId, language = "python", snapshotCount = 0 }: Props) {
  const [showReplay, setShowReplay] = useState(false)
  const pct = feedback.correctness_pct
  const timePct = Math.min(150, feedback.time_used_pct)
  const timeColor = timePct <= 100 ? "bg-emerald-500" : "bg-amber-500"
  const hasEnoughSnapshots = snapshotCount >= 3

  return (
    <section>
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-amber-600">Coding feedback</h2>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
        {/* Correctness */}
        <div className="flex items-center gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-4 font-bold text-lg"
            style={{
              borderColor: pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444",
              color: pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#ef4444",
            }}
          >
            {pct}%
          </div>
          <div>
            <p className="text-[14px] font-semibold text-slate-900">Test correctness: {pct}%</p>
            <p className="text-[12px] text-slate-500">
              {pct === 100 ? "All hidden tests passed" : pct >= 80 ? "Most tests passed" : pct >= 50 ? "Some tests passed" : "Few tests passed"}
            </p>
          </div>
        </div>

        {/* Text blocks */}
        {[
          { label: "Code quality", text: feedback.code_quality },
          { label: "Complexity awareness", text: feedback.complexity_awareness },
          { label: "Communication", text: feedback.communication },
        ].filter((b) => b.text).map(({ label, text }) => (
          <div key={label}>
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
            <p className="text-[13px] leading-relaxed text-slate-700">{text}</p>
          </div>
        ))}

        {/* Biggest lesson */}
        {feedback.biggest_lesson && (
          <div className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-orange-500 mb-1">Biggest lesson</p>
            <p className="text-[14px] font-semibold text-slate-900">{feedback.biggest_lesson}</p>
          </div>
        )}

        {/* Time used */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Time used</p>
            <p className="text-[12px] text-slate-600">{Math.round(timePct)}% of target</p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full transition-all duration-700 ${timeColor}`} style={{ width: `${Math.min(100, timePct)}%` }} />
          </div>
        </div>

        {/* Code replay */}
        {hasEnoughSnapshots ? (
          <button
            type="button"
            onClick={() => setShowReplay((v) => !v)}
            className="w-full rounded-lg border border-orange-200 bg-orange-50 py-2 text-[13px] font-semibold text-orange-600 hover:bg-orange-100"
          >
            {showReplay ? "Hide code replay" : "View code replay"}
          </button>
        ) : null}

        {/* Replay scrubber */}
        {showReplay && hasEnoughSnapshots && (
          <div className="pt-2 border-t border-slate-100">
            <CodeReplayScrubber sessionId={sessionId} language={language} />
          </div>
        )}
      </div>
    </section>
  )
}
