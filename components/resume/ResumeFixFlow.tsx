"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Loader2,
  Lock,
  MessageSquareText,
  Sparkles,
  Wand2,
} from "lucide-react"
import { useFeatureAccess } from "@/lib/hooks/useFeatureAccess"
import { PLAN_NAMES, requiredPlanFor } from "@/lib/gates"
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

const BRAND = "#FF5C18"

// ── Shell ────────────────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="relative mt-4 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
        style={{ background: `linear-gradient(90deg, ${BRAND}, #FF9A3C, #f97316)` }}
      />
      {children}
    </section>
  )
}

function Header({
  autoCount,
  questionCount,
  locked,
}: {
  autoCount: number
  questionCount: number
  locked: boolean
}) {
  return (
    <div className="flex min-w-0 gap-3.5">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1"
        style={{ background: `${BRAND}1A`, borderColor: `${BRAND}33`, boxShadow: "none" }}
      >
        {locked ? (
          <Lock className="h-5 w-5" style={{ color: BRAND }} aria-hidden />
        ) : (
          <Wand2 className="h-5 w-5" style={{ color: BRAND }} aria-hidden />
        )}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[16px] font-bold text-slate-900">AI Fix</h2>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide"
            style={{ background: `${BRAND}1A`, color: BRAND }}
          >
            <Sparkles className="h-2.5 w-2.5" aria-hidden />
            {PLAN_NAMES[requiredPlanFor("resume_ai_fix") ?? "pro"]}
          </span>
        </div>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-slate-600">
          {autoCount > 0
            ? `We can fix ${autoCount} of these from what your resume already says.`
            : "We can fix these once you answer the questions below."}
          {questionCount > 0 && " The rest need facts only you have."}
        </p>
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────

/**
 * AI Fix: propose everything, approve in one click.
 *
 * Propose-then-approve rather than apply-then-undo. A resume is a document
 * someone has to stand behind in an interview, so rewriting it silently and
 * offering a revert afterwards puts the burden in the wrong place. "Select all"
 * plus one Apply button keeps it to a single click for anyone who does not want
 * to read the diff.
 *
 * Pro-gated (pro_max inherits it). The locked state deliberately still shows
 * WHAT would be fixed, by name, drawn from the user's own review — a paywall
 * that hides the value it is charging for gives nobody a reason to pay. The
 * server enforces the same gate, so this is presentation, not protection.
 */
export default function ResumeFixFlow({
  plan,
  onApplied,
}: {
  plan: FixPlanPayload
  onApplied: () => void
}) {
  const { hasAccess, isLoading: gateLoading, showUpgradePrompt } = useFeatureAccess("resume_ai_fix")

  const [phase, setPhase] = useState<Phase>("idle")
  const [edits, setEdits] = useState<ProposedEdit[]>([])
  const [unresolved, setUnresolved] = useState<Unresolved[]>([])
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({})
  const [error, setError] = useState<string | null>(null)

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

  async function post(payload: Record<string, unknown>) {
    const res = await fetch("/api/resume/review/fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; requiredPlan?: string }
      // The server enforces the same gate; surface it rather than a bare 403.
      if (res.status === 403 && body.requiredPlan) {
        throw new Error(`AI Fix is a ${body.requiredPlan} feature.`)
      }
      throw new Error(body.error ?? `Failed (${res.status})`)
    }
    return res.json()
  }

  async function preview() {
    setPhase("previewing")
    setError(null)
    try {
      const data = (await post({ action: "preview", answers })) as {
        edits: ProposedEdit[]
        unresolved: Unresolved[]
      }
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
      await post({ action: "apply", edits: chosen })
      setPhase("done")
      onApplied()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply the changes")
      setPhase("review")
    }
  }

  if (fixableCount === 0 || gateLoading) return null

  // ── Locked ─────────────────────────────────────────────────────────────────
  if (!hasAccess) {
    const wouldFix = [...plan.auto, ...plan.needsInput].slice(0, 5)
    return (
      <Card>
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <Header autoCount={plan.auto.length} questionCount={plan.questions.length} locked />
            <button
              type="button"
              onClick={showUpgradePrompt}
              className="shrink-0 rounded-xl px-4 py-2 text-[12.5px] font-bold text-white transition hover:brightness-105 active:brightness-95"
              style={{
                background: `linear-gradient(90deg, ${BRAND}, #FF7A35)`,
                boxShadow: "0 4px 12px rgba(255,92,24,0.3)",
              }}
            >
              Unlock AI Fix
            </button>
          </div>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
              What it would do to your resume
            </p>
            <ul className="mt-2 space-y-1.5">
              {wouldFix.map((s) => (
                <li key={s.findingId} className="flex items-start gap-2 text-[13px] text-slate-700">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] leading-relaxed text-slate-500">
              Your review above stays free. AI Fix is the part that rewrites the document for you and
              shows you every change before it is saved.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  // ── Unlocked ───────────────────────────────────────────────────────────────
  return (
    <Card>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <Header autoCount={plan.auto.length} questionCount={plan.questions.length} locked={false} />

          {phase !== "review" && phase !== "done" && (
            <button
              type="button"
              onClick={() => void preview()}
              disabled={phase === "previewing"}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-[12.5px] font-bold text-white transition hover:brightness-105 active:brightness-95 disabled:opacity-60"
              style={{
                background: `linear-gradient(90deg, ${BRAND}, #FF7A35)`,
                boxShadow: "0 4px 12px rgba(255,92,24,0.3)",
              }}
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
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-800">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
          </p>
        )}

        {/* ── Answer queue ───────────────────────────────────────────── */}
        {plan.questions.length > 0 && phase !== "done" && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
              <MessageSquareText className="h-3 w-3" aria-hidden />
              {plan.questions.length} thing{plan.questions.length === 1 ? "" : "s"} only you can answer
              {answeredCount > 0 && ` · ${answeredCount} answered`}
            </p>

            <div className="mt-3 space-y-4">
              {plan.questions.map((q) => {
                const strategy = plan.needsInput.find((s) => s.findingId === q.findingId)
                const value = answers[q.findingId]?.[q.id] ?? ""
                const answered = value.trim().length > 0
                return (
                  <div
                    key={`${q.findingId}:${q.id}`}
                    className={`rounded-lg border bg-white p-3.5 transition ${
                      answered ? "border-emerald-200" : "border-slate-200"
                    }`}
                  >
                    <label className="block text-[13px] font-semibold leading-snug text-slate-800">
                      {q.prompt}
                    </label>
                    {strategy?.reason && (
                      <p className="mt-1 text-[12px] italic leading-relaxed text-slate-500">
                        {strategy.reason}
                      </p>
                    )}
                    {q.kind === "choice" ? (
                      <select
                        value={value}
                        onChange={(e) => setAnswer(q.findingId, q.id, e.target.value)}
                        className="mt-2.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-[#FF5C18]"
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
                        className="mt-2.5 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#FF5C18]"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Proposed changes ───────────────────────────────────────── */}
        {phase === "review" && (
          <div className="mt-4">
            {edits.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-[13px] leading-relaxed text-slate-600">
                Nothing could be changed automatically. Answer the questions above, or open Studio from
                a finding to do it by hand.
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
                    {edits.length} proposed change{edits.length === 1 ? "" : "s"}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setApproved((current) =>
                        current.size === edits.length ? new Set() : new Set(edits.map((e) => e.findingId)),
                      )
                    }
                    className="text-[12px] font-semibold hover:underline"
                    style={{ color: BRAND }}
                  >
                    {approved.size === edits.length ? "Deselect all" : "Select all"}
                  </button>
                </div>

                <div className="mt-2 space-y-2.5">
                  {edits.map((edit) => {
                    const on = approved.has(edit.findingId)
                    return (
                      <div
                        key={edit.findingId}
                        className={`rounded-xl border bg-white p-4 transition ${
                          on ? "border-slate-300 shadow-sm" : "border-slate-200 opacity-70"
                        }`}
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
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                            style={{ accentColor: BRAND }}
                          />
                          <span className="text-[13.5px] font-bold leading-snug text-slate-900">
                            {edit.label}
                          </span>
                        </label>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                              Now
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-600">
                              {edit.before}
                            </p>
                          </div>
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                            <p className="text-[10.5px] font-bold uppercase tracking-wide text-emerald-600">
                              After
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-900">
                              {edit.after}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void apply()}
                    disabled={approved.size === 0}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white shadow-[0_4px_12px_rgba(5,150,105,0.25)] transition hover:bg-emerald-700 disabled:opacity-50 disabled:shadow-none"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden /> Apply {approved.size} change
                    {approved.size === 1 ? "" : "s"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhase("idle")}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  {answeredCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void preview()}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold hover:underline"
                      style={{ color: BRAND }}
                    >
                      Re-run with my answers <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>
              </>
            )}

            {unresolved.length > 0 && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
                <p className="text-[11.5px] font-bold uppercase tracking-wide text-amber-700">
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
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] font-semibold text-emerald-900">
            <Check className="h-3.5 w-3.5" aria-hidden /> Applied. Re-reading your resume…
          </p>
        )}
      </div>
    </Card>
  )
}
