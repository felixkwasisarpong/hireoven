"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  GitBranch,
  ArrowRight,
  Plane,
  Loader2,
  Sparkles,
  Building2,
  Wrench,
  Brain,
  Lightbulb,
  AlertTriangle,
  Users,
} from "lucide-react"
import { FIELDS, type ResumeSignal } from "@/lib/resume/signal"
import type { BridgePath } from "@/lib/resume/bridge"
import type { BridgeReasoning } from "@/lib/resume/bridge-reasoning"
import type { PivotEvidence } from "@/lib/career/pivot-evidence"

type InitResponse = {
  hasResume: boolean
  grounded?: boolean
  signal?: ResumeSignal
  from?: string | null
  suggestedTo?: { toKey: string } | null
  bridge?: BridgePath | null
  evidence?: PivotEvidence | null
  reasoning?: BridgeReasoning | null
}

function pct(x?: number): number | null {
  return typeof x === "number" ? Math.round(x * 100) : null
}

function bridgeLabel(overlap: number): { label: string; color: string } {
  if (overlap >= 45) return { label: "Short bridge", color: "#059669" }
  if (overlap >= 25) return { label: "Moderate bridge", color: "#f59e0b" }
  return { label: "Long bridge", color: "#ef4444" }
}

export default function PivotView() {
  const [data, setData] = useState<InitResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [bridge, setBridge] = useState<BridgePath | null>(null)
  const [evidence, setEvidence] = useState<PivotEvidence | null>(null)
  const [bridgeLoading, setBridgeLoading] = useState(false)
  const [reasoning, setReasoning] = useState<BridgeReasoning | null>(null)
  const [reasoningLoading, setReasoningLoading] = useState(false)
  // The matching lane is a single value on the résumé (`resumes.target_field`),
  // shared with the Positioning tab — committing a pivot here replaces it.
  const [savedField, setSavedField] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/resume/bridge")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Failed (${r.status})`)
        return r.json()
      })
      .then((d: InitResponse) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  // Read the lane the résumé is currently matched as, so this page can show
  // whether a target is already committed rather than offering a blind action.
  useEffect(() => {
    let alive = true
    fetch("/api/resume/signal")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { targetField?: string | null } | null) => {
        if (alive && d) setSavedField(d.targetField ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Deep-link / auto-select: /dashboard/pivot?to=<field> (used by the feed pivot
  // nudge) preselects that target; otherwise fall back to the server's suggested
  // target so landing here cold shows a concrete pivot, not an empty picker.
  useEffect(() => {
    if (!data?.from || to) return
    const param = new URLSearchParams(window.location.search).get("to")
    const target = param ?? data.suggestedTo?.toKey ?? null
    if (target && target !== data.from) pickTarget(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  function pickTarget(key: string) {
    if (!data?.from) return
    setTo(key)
    setBridge(null)
    setEvidence(null)
    setReasoning(null)
    setBridgeLoading(true)
    fetch(`/api/resume/bridge?to=${encodeURIComponent(key)}&from=${encodeURIComponent(data.from)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d: InitResponse) => {
        setBridge(d.bridge ?? null)
        setEvidence(d.evidence ?? null)
      })
      .catch(() => {
        setBridge(null)
        setEvidence(null)
      })
      .finally(() => setBridgeLoading(false))
  }

  /**
   * Commit the selected pivot as the résumé's matching lane.
   *
   * Writes `resumes.target_field` through the same endpoint the Positioning tab
   * uses — there is one lane per résumé, so this replaces whatever was set
   * there. The write also bumps `updated_at`, which is what makes the batch
   * scorer re-score the feed against the new positioning.
   */
  function commitLane(key: string) {
    setCommitting(true)
    setCommitError(null)
    fetch("/api/resume/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: key }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Failed (${r.status})`)
        }
        return r.json()
      })
      .then((d: { targetField?: string | null }) => setSavedField(d.targetField ?? key))
      .catch((e: Error) => setCommitError(e.message))
      .finally(() => setCommitting(false))
  }

  function getPlan() {
    if (!data?.from || !to) return
    setReasoningLoading(true)
    fetch(`/api/resume/bridge?to=${encodeURIComponent(to)}&from=${encodeURIComponent(data.from)}&reason=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d: InitResponse) => setReasoning(d.reasoning ?? null))
      .catch(() => setReasoning(null))
      .finally(() => setReasoningLoading(false))
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Mapping your pivot options…
      </div>
    )
  }
  if (error) {
    return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
  }
  if (!data?.hasResume || !data.from) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
        <p className="text-[15px] font-semibold text-slate-800">No parsed resume yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-500">
          Upload a resume and we&apos;ll map realistic pivots from the field it reads as.
        </p>
        <Link
          href="/dashboard/resume"
          className="mt-4 inline-flex rounded-full bg-emerald-600 px-5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700"
        >
          Upload resume
        </Link>
      </div>
    )
  }

  const fromLabel = FIELDS.find((f) => f.key === data.from)?.label ?? data.from
  const targets = FIELDS.filter((f) => f.key !== data.from)

  return (
    <div className="space-y-6">
      <header>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <GitBranch className="h-3.5 w-3.5" /> Career pivot
        </span>
        <h1 className="mt-3 text-[22px] font-bold text-slate-900">Bridge to another field</h1>
        <p className="mt-1 text-[14px] text-slate-600">
          Your resume reads strongest as <strong className="text-slate-900">{fromLabel}</strong>. Pick where you want to
          go — we&apos;ll show what carries over, what to build, and the real jobs that bridge the two.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-400">Pivot toward</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {targets.map((f) => {
            const active = to === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => pickTarget(f.key)}
                className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  active
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>

        {/* Commit bar — turns an explored pivot into the lane the matcher uses. */}
        {to && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            {savedField === to ? (
              <p className="flex items-center gap-2 text-[13px] font-semibold text-emerald-700">
                <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
                Matching you as {FIELDS.find((f) => f.key === to)?.label ?? to}. Your feed re-scores on the
                next refresh.
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12.5px] leading-relaxed text-slate-600">
                  {savedField
                    ? `You're currently matched as ${
                        FIELDS.find((f) => f.key === savedField)?.label ?? savedField
                      }. Switching replaces it — there's one lane per résumé.`
                    : "Commit this and the matcher starts ranking jobs in this field higher for you."}
                </p>
                <button
                  type="button"
                  onClick={() => commitLane(to)}
                  disabled={committing}
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {committing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {savedField ? "Switch my lane" : "Match me as this"}
                </button>
              </div>
            )}
            {commitError && (
              <p className="mt-2 text-[12.5px] font-medium text-rose-700">{commitError}</p>
            )}
          </div>
        )}
      </section>

      {bridgeLoading && (
        <div className="flex items-center gap-2 p-2 text-[13px] text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Building your bridge…
        </div>
      )}

      {bridge && !bridgeLoading && (
        <div className="space-y-6">
          {/* Bridge header: from → to, distance, current fit. */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-slate-900">
              <span>{bridge.fromLabel}</span>
              <ArrowRight className="h-4 w-4 text-slate-400" />
              <span>{bridge.toLabel}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: bridgeLabel(bridge.overlapPct).color }}
                />
                <strong className="text-slate-900">{bridgeLabel(bridge.overlapPct).label}</strong>
                <span className="text-slate-500">· {bridge.overlapPct}% skill overlap</span>
              </span>
              <span className="text-slate-500">
                Your resume already reads at <strong className="text-slate-900">{bridge.targetFit}%</strong> of{" "}
                {bridge.toLabel} demand
              </span>
              {pct(bridge.sponsorshipShare) !== null && (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600">
                  <Plane className="h-3.5 w-3.5" /> {pct(bridge.sponsorshipShare)}% sponsor visas
                </span>
              )}
            </div>

            {/* Evidence from the transition graph — only when it's real. */}
            {evidence && (
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
                <Users className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                <p className="text-[13px] text-emerald-900">
                  <strong className="font-semibold">{evidence.sampleSize} people</strong> we&apos;ve tracked made the{" "}
                  {bridge.fromLabel} → {bridge.toLabel} move
                  {evidence.medianGapMonths !== null ? (
                    <>
                      {" "}
                      — it typically took about{" "}
                      <strong className="font-semibold">
                        {evidence.medianGapMonths} month{evidence.medianGapMonths === 1 ? "" : "s"}
                      </strong>
                      .
                    </>
                  ) : (
                    "."
                  )}
                  {pct(evidence.hiredOutcomeShare)! > 0 && (
                    <span className="text-emerald-700">
                      {" "}
                      {pct(evidence.hiredOutcomeShare)}% of those we followed all the way to a hire.
                    </span>
                  )}
                </p>
              </div>
            )}
          </section>

          {bridge.transferable.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
                <Sparkles className="h-4 w-4 text-emerald-600" /> Carries over
              </h2>
              <p className="mt-1 text-[13px] text-slate-500">
                {bridge.toLabel} demands these and your resume already shows them — lead with them.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {bridge.transferable.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[12px] font-medium capitalize text-emerald-800"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {bridge.toBuild.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
                <Wrench className="h-4 w-4 text-slate-500" /> Build these
              </h2>
              <p className="mt-1 text-[13px] text-slate-500">
                The most in-demand {bridge.toLabel} skills your resume doesn&apos;t show yet — the gap to close.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {bridge.toBuild.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium capitalize text-slate-600"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* The wow: real postings that demand both fields. */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
              <Building2 className="h-4 w-4 text-emerald-600" /> Bridge roles hiring now
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Live US roles that ask for both {bridge.fromLabel} and {bridge.toLabel} — the realistic stepping-stone
              jobs to target.
            </p>
            {bridge.bridgeRoles.length === 0 ? (
              <p className="mt-3 text-[13px] text-slate-500">
                No roles bridging these two fields in the last few months — a sign it&apos;s a longer pivot. Build the
                skills above first, then re-check.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {bridge.bridgeRoles.map((r) => (
                  <li
                    key={r.title}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2"
                  >
                    <span className="text-[13.5px] font-semibold capitalize text-slate-800">{r.title}</span>
                    <span className="flex items-center gap-3 text-[12px]">
                      <span className="text-slate-500">
                        {r.count} open role{r.count === 1 ? "" : "s"}
                      </span>
                      {pct(r.sponsorshipShare) !== null && pct(r.sponsorshipShare)! > 0 && (
                        <span className="inline-flex items-center gap-1 font-medium text-indigo-600">
                          <Plane className="h-3 w-3" /> {pct(r.sponsorshipShare)}%
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* AI reasoning over the facts above — opt-in, grounded, honest. */}
          <section className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 shadow-sm">
            <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-slate-900">
              <Brain className="h-4 w-4 text-indigo-600" /> AI pivot plan
            </h2>
            <p className="mt-1 text-[13px] text-slate-500">
              Claude reasons over the numbers above — your transferable skills, the gaps, and the real bridge roles — to
              sequence the move. It only works from these facts.
            </p>

            {!reasoning && !reasoningLoading && (
              <button
                type="button"
                onClick={getPlan}
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-indigo-700"
              >
                <Sparkles className="h-3.5 w-3.5" /> Build my pivot plan
              </button>
            )}

            {reasoningLoading && (
              <div className="mt-3 flex items-center gap-2 text-[13px] text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Reasoning over your bridge…
              </div>
            )}

            {reasoning && (
              <div className="mt-4 space-y-4">
                <p className="text-[14px] font-medium text-slate-800">{reasoning.summary}</p>

                {reasoning.steps.length > 0 && (
                  <ol className="space-y-2.5">
                    {reasoning.steps.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                          {i + 1}
                        </span>
                        <div>
                          <p className="text-[13.5px] font-semibold text-slate-900">{s.title}</p>
                          {s.detail && <p className="text-[13px] text-slate-600">{s.detail}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}

                {reasoning.positioning && (
                  <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      How to position
                    </p>
                    <p className="mt-1 text-[13px] text-slate-700">{reasoning.positioning}</p>
                  </div>
                )}

                {reasoning.firstMove && (
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
                    <Lightbulb className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                        Start here
                      </p>
                      <p className="mt-0.5 text-[13px] font-medium text-emerald-900">{reasoning.firstMove}</p>
                    </div>
                  </div>
                )}

                {reasoning.risks.length > 0 && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
                    <ul className="space-y-1 text-[13px] text-amber-900">
                      {reasoning.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>

          <p className="text-[12px] text-slate-400">
            Overlap and skills come from what real {bridge.toLabel} jobs ask for; bridge roles are aggregated from the
            live job index. The AI plan only reasons over those facts — nothing is invented.
          </p>
        </div>
      )}
    </div>
  )
}
