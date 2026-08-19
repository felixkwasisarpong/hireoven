"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Check, Loader2, Sparkles, Wand2 } from "lucide-react"
import type { FixQuestion, FixStrategy } from "@/lib/resume/fix-plan"
import type { ProposedEdit } from "@/lib/resume/fix-apply"

export type FixPlanPayload = {
  auto: FixStrategy[]
  needsInput: FixStrategy[]
  manual: FixStrategy[]
  questions: Array<FixQuestion & { findingId: string }>
}

type Unresolved = { findingId: string; kind: string; label: string; reason?: string }

type Phase = "idle" | "previewing" | "review" | "applying" | "done"

/**
 * AI Fix: propose everything, let the user approve it in one click.
 *
 * The flow is deliberately propose-then-approve rather than apply-then-undo. A
 * resume is a document someone has to stand behind in an interview, so silently
 * rewriting it and offering a revert afterwards puts the burden in the wrong
 * place. "Approve all" keeps it to a single click for anyone who does not want
 * to read the diff, and the per-change toggles are there for anyone who does.
 *
 * The questions below the button are the honest half: they exist because some
 * findings cannot be fixed without facts the resume does not contain, and
 * guessing at those would hand the user a number they cannot defend.
 */
export default function ResumeFixFlow({
  plan,
  onApplied,
}: {
  plan: FixPlanPayload
  onApplied: () => void
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [edits, setEdits] = useState<ProposedEdit[]>([])
  const [unresolved, setUnresolved] = useState<Unresolved[]>([])
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({})
  const [error, setError] = useState<string | null>(null)

  const answerable = plan.questions.length > 0
  const fixableCount = plan.auto.length + plan.needsInput.length

  const answeredCount = useMemo(
    () => plan.questions.filter((q) => (answers[q.findingId]?.[q.id] ?? "").trim().length > 0).length,
    [plan.questions, answers],
  )

  function setAnswer(findingId: string, questionId: string, value: string) {
    setAnswers((current) => ({
      ...current,
      [findingId]: { ...(current[findingId] ?? {}), [questionId]: value },
    }))
  }

  async function preview() {
    setPhase("previewing")
    setError(null)
    try {
      const res = await fetch("/api/resume/review/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", answers }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Failed (${res.status})`)
      const data = (await res.json()) as { edits: ProposedEdit[]; unresolved: Unresolved[] }
      setEdits(data.edits ?? [])
      setUnresolved(data.unresolved ?? [])
      setApproved(new Set((data.edits ?? []).map((e) => e.findingId)))
      setPhase("review")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not prepare the fixes")
      setPhase("idle")
    }
  }

  async function apply() {
    const chosen = edits.filter((e) => approved.has(e.findingId))
    if (chosen.length === 0) return
    setPhase("applying")
    setError(null)
    try {
      const res = await fetch("/api/resume/review/fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", edits: chosen }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Failed (${res.status})`)
      setPhase("done")
      onApplied()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the changes")
      setPhase("review")
    }
  }

  if (fixableCount === 0) return null

  return (
    <section className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
            <Wand2 className="h-4 w-4 text-indigo-600" aria-hidden /> AI Fix
          </h2>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-slate-600">
            {plan.auto.length > 0
              ? `We can fix ${plan.auto.length} of these from what your resume already says.`
              : "We can fix these once you answer the questions below."}
            {answerable && " The rest need facts only you have."}
          </p>
        </div>

        {phase !== "review" && phase !== "done" && (
          <button
            type="button"
            onClick={() => void preview()}
            disabled={phase === "previewing"}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {phase === "previewing" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Preparing…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> Fix what you can
              </>
            )}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {/* ── Answer queue ─────────────────────────────────────────────── */}
      {answerable && phase !== "done" && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-[12px] font-bold uppercase tracking-wide text-slate-500">
            {plan.questions.length} thing{plan.questions.length === 1 ? "" : "s"} only you can answer
            {answeredCount > 0 && ` · ${answeredCount} answered`}
          </p>
          <div className="mt-3 space-y-4">
            {plan.questions.map((q) => {
              const strategy = plan.needsInput.find((s) => s.findingId === q.findingId)
              const value = answers[q.findingId]?.[q.id] ?? ""
              return (
                <div key={`${q.findingId}:${q.id}`}>
                  <label className="block text-[13px] font-semibold text-slate-800">{q.prompt}</label>
                  {strategy?.reason && (
                    <p className="mt-0.5 text-[12px] italic leading-relaxed text-slate-500">
                      {strategy.reason}
                    </p>
                  )}
                  {q.kind === "choice" ? (
                    <select
                      value={value}
                      onChange={(e) => setAnswer(q.findingId, q.id, e.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-indigo-500"
                    >
                      <option value="">Choose…</option>
                      {(q.choices ?? []).map((choice) => (
                        <option key={choice} value={choice}>
                          {choice}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <textarea
                      value={value}
                      onChange={(e) => setAnswer(q.findingId, q.id, e.target.value)}
                      placeholder={q.placeholder}
                      rows={2}
                      className="mt-2 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-indigo-500"
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Proposed changes ─────────────────────────────────────────── */}
      {phase === "review" && (
        <div className="mt-4">
          {edits.length === 0 ? (
            <p className="rounded-lg border border-slate-200 bg-white p-4 text-[13px] text-slate-600">
              Nothing could be changed automatically. Answer the questions above, or open Studio from a
              finding to do it by hand.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-bold uppercase tracking-wide text-slate-500">
                  {edits.length} proposed change{edits.length === 1 ? "" : "s"}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setApproved((current) =>
                      current.size === edits.length ? new Set() : new Set(edits.map((e) => e.findingId)),
                    )
                  }
                  className="text-[12px] font-semibold text-indigo-700 hover:underline"
                >
                  {approved.size === edits.length ? "Deselect all" : "Select all"}
                </button>
              </div>

              <div className="mt-2 space-y-2">
                {edits.map((edit) => {
                  const on = approved.has(edit.findingId)
                  return (
                    <div
                      key={edit.findingId}
                      className={`rounded-lg border bg-white p-3.5 ${on ? "border-indigo-300" : "border-slate-200"}`}
                    >
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setApproved((current) => {
                              const next = new Set(current)
                              if (next.has(edit.findingId)) next.delete(edit.findingId)
                              else next.add(edit.findingId)
                              return next
                            })
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-indigo-600"
                        />
                        <span className="text-[13.5px] font-bold text-slate-900">{edit.label}</span>
                      </label>

                      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-md border border-rose-100 bg-rose-50/60 p-2.5">
                          <p className="text-[10.5px] font-bold uppercase tracking-wide text-rose-500">Now</p>
                          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-700">
                            {edit.before}
                          </p>
                        </div>
                        <div className="rounded-md border border-emerald-100 bg-emerald-50/60 p-2.5">
                          <p className="text-[10.5px] font-bold uppercase tracking-wide text-emerald-600">
                            After
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-800">
                            {edit.after}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void apply()}
                  disabled={approved.size === 0 || phase !== "review"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" aria-hidden /> Apply {approved.size} change
                  {approved.size === 1 ? "" : "s"}
                </button>
                <button
                  type="button"
                  onClick={() => setPhase("idle")}
                  className="rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                {answeredCount > 0 && (
                  <button
                    type="button"
                    onClick={() => void preview()}
                    className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-indigo-700 hover:underline"
                  >
                    Re-run with my answers <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </>
          )}

          {unresolved.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3.5">
              <p className="text-[12px] font-bold uppercase tracking-wide text-amber-700">
                Still needs you
              </p>
              <ul className="mt-1.5 space-y-1">
                {unresolved.map((u) => (
                  <li key={u.findingId} className="text-[12.5px] leading-relaxed text-amber-900">
                    <span className="font-semibold">{u.label}</span>
                    {u.reason ? ` — ${u.reason}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {phase === "applying" && (
        <p className="mt-3 flex items-center gap-2 text-[13px] text-slate-600">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Applying…
        </p>
      )}

      {phase === "done" && (
        <p className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[13px] font-semibold text-emerald-900">
          <Check className="h-3.5 w-3.5" aria-hidden /> Applied. Re-reading your resume…
        </p>
      )}
    </section>
  )
}
