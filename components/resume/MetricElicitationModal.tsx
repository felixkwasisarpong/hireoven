"use client"

/**
 * MetricElicitationModal — turns a vague resume bullet into a quantified one
 * using the candidate's REAL numbers.
 *
 * Flow: ask 1–4 targeted questions about the metrics this bullet could carry →
 * candidate fills in what they can (skipping is fine) → rewrite the bullet using
 * ONLY the provided numbers (never invented) → review before/after → apply.
 *
 * Self-contained: hits POST /api/resume/bullet/quantify (mode "questions" then
 * "rewrite"). The parent only supplies the bullet + context and receives the
 * final string via onApply.
 */

import { useCallback, useEffect, useState } from "react"
import { Check, Loader2, Sigma, X } from "lucide-react"
import type { MetricQuestion } from "@/lib/resume/metric-elicitation"

type Props = {
  open: boolean
  bullet: string
  resumeId: string
  jobId?: string | null
  experienceIndex?: number | null
  bulletIndex?: number | null
  onClose: () => void
  onApply: (rewritten: string) => void
}

type Phase = "loading" | "questions" | "rewriting" | "review" | "error"

export default function MetricElicitationModal({
  open,
  bullet,
  resumeId,
  jobId,
  experienceIndex,
  bulletIndex,
  onClose,
  onApply,
}: Props) {
  const [phase, setPhase] = useState<Phase>("loading")
  const [questions, setQuestions] = useState<MetricQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [rewritten, setRewritten] = useState("")
  const [usedMetrics, setUsedMetrics] = useState(false)
  const [error, setError] = useState("")

  const loadQuestions = useCallback(async () => {
    setPhase("loading")
    setError("")
    setAnswers({})
    try {
      const res = await fetch("/api/resume/bullet/quantify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "questions", resumeId, bullet, jobId, experienceIndex, bulletIndex }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to load questions")
      const next: MetricQuestion[] = Array.isArray(data.questions) ? data.questions : []
      setQuestions(next)
      setPhase("questions")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
      setPhase("error")
    }
  }, [resumeId, bullet, jobId, experienceIndex, bulletIndex])

  useEffect(() => {
    if (open) void loadQuestions()
  }, [open, loadQuestions])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  async function submit(answerList: { label: string; value: string }[]) {
    setPhase("rewriting")
    setError("")
    try {
      const res = await fetch("/api/resume/bullet/quantify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "rewrite",
          resumeId,
          bullet,
          jobId,
          experienceIndex,
          bulletIndex,
          answers: answerList,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "Failed to rewrite bullet")
      setRewritten(typeof data.suggestion === "string" ? data.suggestion : bullet)
      setUsedMetrics(Boolean(data.usedMetrics))
      setPhase("review")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
      setPhase("error")
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-start gap-2">
            <Sigma className="mt-0.5 h-4 w-4 text-[#5B4DFF]" />
            <div>
              <p className="text-sm font-semibold text-slate-800">Add your real numbers</p>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                We only use the figures you provide — never invented ones.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
            <span className="font-semibold text-slate-600">Bullet:</span> {bullet}
          </p>

          {phase === "loading" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Finding the metrics worth adding…
            </div>
          )}

          {phase === "rewriting" && (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Rewriting with your numbers…
            </div>
          )}

          {phase === "error" && (
            <div className="mt-4">
              <p className="text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => void loadQuestions()}
                className="mt-3 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Try again
              </button>
            </div>
          )}

          {phase === "questions" && (
            <>
              {questions.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  No specific metrics to ask about — we can still sharpen this bullet without numbers.
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  {questions.map((q) => (
                    <label key={q.id} className="block">
                      <span className="text-xs font-medium text-slate-700">{q.label}</span>
                      <input
                        type="text"
                        value={answers[q.id] ?? ""}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder={q.hint}
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#5B4DFF]"
                      />
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {phase === "review" && (
            <div className="mt-4 space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Before</p>
                <p className="mt-1 text-sm leading-6 text-slate-500 line-through decoration-slate-300">{bullet}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5B4DFF]">After</p>
                <p className="mt-1 text-sm leading-6 text-slate-800">{rewritten}</p>
              </div>
              {!usedMetrics && (
                <p className="text-[11px] text-amber-700">
                  No numbers were added — this is a wording-only rewrite. Add figures above for a stronger,
                  quantified bullet.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
          {phase === "questions" && (
            <>
              <button
                type="button"
                onClick={() => void submit([])}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Skip — rewrite without numbers
              </button>
              <button
                type="button"
                onClick={() =>
                  void submit(questions.map((q) => ({ label: q.label, value: answers[q.id] ?? "" })))
                }
                className="inline-flex items-center gap-2 rounded-xl bg-[#5B4DFF] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#493EE6]"
              >
                Rewrite with my numbers
              </button>
            </>
          )}
          {phase === "review" && (
            <>
              <button
                type="button"
                onClick={() => setPhase("questions")}
                className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => onApply(rewritten)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <Check className="h-4 w-4" />
                Apply to resume
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
