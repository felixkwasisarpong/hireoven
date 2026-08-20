"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSearch,
  Loader2,
  Quote,
  GraduationCap,
  Sparkles,
  Stethoscope,
  Target,
  Upload,
  Wrench,
} from "lucide-react"
import type { FindingSeverity, ResumeFinding } from "@/lib/resume/review"
import ResumeFixFlow, { type FixPlanPayload } from "@/components/resume/ResumeFixFlow"

type Step = ResumeFinding & { explanation: string; doThis: string }

type ReviewResponse = {
  hasResume: boolean
  /** An upload is still being parsed — the page waits rather than saying "no resume". */
  parsing?: boolean
  parseFailed?: boolean
  parseError?: string | null
  grounded?: boolean
  documentKind?: "academic_cv" | "resume"
  documentKindLabel?: string
  documentKindSignals?: string[]
  publicationCount?: number
  resume?: { id: string; name: string | null; updatedAt: string }
  readsAs?: string | null
  verdict?: string
  blockers?: number
  majors?: number
  steps?: Step[]
  opening?: string
  firstMove?: string
  narrated?: boolean
  fixPlan?: FixPlanPayload
}

const SEVERITY: Record<
  FindingSeverity,
  { label: string; chip: string; bar: string; dot: string }
> = {
  blocker: {
    label: "Ends applications",
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    bar: "bg-rose-500",
    dot: "bg-rose-500",
  },
  major: {
    label: "Costs you reads",
    chip: "border-amber-200 bg-amber-50 text-amber-800",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
  },
  minor: {
    label: "Polish",
    chip: "border-slate-200 bg-slate-50 text-slate-600",
    bar: "bg-slate-400",
    dot: "bg-slate-400",
  },
}

/** One card treatment across the page, matching the AI Fix surface. */
const CARD = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]"

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</div>
}

export default function ResumeReviewView() {
  const [data, setData] = useState<ReviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [narrating, setNarrating] = useState(false)
  const [index, setIndex] = useState(0)
  const [mode, setMode] = useState<"walkthrough" | "all">("walkthrough")
  // Bumped after AI Fix applies, so the findings reflect what just changed.
  const [reloadKey, setReloadKey] = useState(0)

  // Two-phase load: the deterministic diagnosis paints immediately, then the
  // narration pass swaps in richer explanations. A slow or capped model changes
  // the prose, never whether a finding is shown.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null

    async function load(attempt = 0) {
      try {
        const r = await fetch("/api/resume/review")
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Failed (${r.status})`)
        const d = (await r.json()) as ReviewResponse
        if (!alive) return

        setData(d)
        setLoading(false)

        // An upload landed here before parsing finished. Wait for it rather than
        // telling the user they have no resume.
        if (!d.hasResume && d.parsing && attempt < 40) {
          timer = setTimeout(() => void load(attempt + 1), 2500)
          return
        }
        if (!d.hasResume || !d.steps?.length) return

        setNarrating(true)
        const n = await fetch("/api/resume/review?narrate=1")
          .then((res) => (res.ok ? (res.json() as Promise<ReviewResponse>) : null))
          .catch(() => null)
        if (alive && n?.narrated) setData(n)
        if (alive) setNarrating(false)
      } catch (e) {
        if (!alive) return
        setError(e instanceof Error ? e.message : "Something went wrong")
        setLoading(false)
      }
    }

    void load()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [reloadKey])

  const steps = useMemo(() => data?.steps ?? [], [data])
  const total = steps.length
  const atEnd = index >= total

  if (loading) {
    return (
      <Shell>
        <div className={`flex items-center gap-3 p-6 text-slate-600 ${CARD}`}>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="text-[14px]">Reading your resume the way a recruiter would…</span>
        </div>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
          <div>
            <p className="text-[14px] font-semibold text-rose-900">We could not review your resume</p>
            <p className="mt-1 text-[13px] text-rose-700">{error}</p>
          </div>
        </div>
      </Shell>
    )
  }

  if (data && !data.hasResume && data.parsing) {
    return (
      <Shell>
        <div className={`p-8 text-center ${CARD}`}>
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-orange-600" aria-hidden />
          <h2 className="mt-4 text-[17px] font-bold text-slate-900">Reading your resume</h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-slate-600">
            We are pulling out every section — including publications, grants, and teaching if you
            have them — before we review anything. This takes a few seconds.
          </p>
        </div>
      </Shell>
    )
  }

  if (data && !data.hasResume && data.parseFailed) {
    return (
      <Shell>
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-6">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <div>
            <p className="text-[14px] font-semibold text-amber-900">We could not read that file</p>
            <p className="mt-1 text-[13px] leading-relaxed text-amber-800">
              {data.parseError ?? "The upload saved, but no text could be extracted from it."}
            </p>
            <Link
              href="/dashboard/resume"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-amber-900 underline underline-offset-2"
            >
              Try another file <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </Shell>
    )
  }

  if (!data?.hasResume) {
    return (
      <Shell>
        <div className={`p-8 text-center ${CARD}`}>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-orange-50">
            <Upload className="h-5 w-5 text-orange-600" aria-hidden />
          </div>
          <h2 className="mt-4 text-[17px] font-bold text-slate-900">Upload a resume to get your review</h2>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-slate-600">
            We read it the way a recruiter and an applicant tracking system do, then tell you what is
            actually costing you interviews, in the order it costs you.
          </p>
          <Link
            href="/dashboard/resume"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-orange-700"
          >
            Upload your resume <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </Shell>
    )
  }

  const blockers = data.blockers ?? 0
  const majors = data.majors ?? 0

  return (
    <Shell>
      {/* ── Verdict ─────────────────────────────────────────────────── */}
      <header className={`relative overflow-hidden p-6 ${CARD}`}>
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-0.5"
          style={{ background: "linear-gradient(90deg, #FF5C18, #FF9A3C, #f97316)" }}
        />
        <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-orange-600">
          <Stethoscope className="h-3.5 w-3.5" aria-hidden />
          Resume review
        </div>
        <h1 className="mt-2 text-[22px] font-bold leading-tight text-slate-900">
          Why you are not getting interviews
        </h1>

        <p className="mt-3 text-[14.5px] leading-relaxed text-slate-700">{data.opening}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
          {data.documentKind === "academic_cv" && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700">
              <GraduationCap className="h-3 w-3" aria-hidden /> Read as an {data.documentKindLabel}
              {typeof data.publicationCount === "number" && data.publicationCount > 0
                ? ` · ${data.publicationCount} publications`
                : ""}
            </span>
          )}
          {data.readsAs && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700">
              <Target className="h-3 w-3" aria-hidden /> Reads as {data.readsAs}
            </span>
          )}
          {blockers > 0 && (
            <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-semibold text-rose-700">
              {blockers} that can end an application
            </span>
          )}
          {majors > 0 && (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800">
              {majors} costing you reads
            </span>
          )}
          {narrating && (
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> working through the detail…
            </span>
          )}
        </div>

        {data.documentKind === "academic_cv" && (
          <p className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-[12.5px] leading-relaxed text-indigo-900">
            We spotted {data.documentKindSignals?.join("; ") || "academic CV conventions"}, so we are
            reviewing this against CV conventions, not resume ones. Length, citation-style entries, and
            unquantified lines are not counted against you.
          </p>
        )}
      </header>

      {data.fixPlan && (
        <ResumeFixFlow
          plan={data.fixPlan}
          onApplied={() => {
            setIndex(0)
            setReloadKey((k) => k + 1)
          }}
        />
      )}

      {total === 0 ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-6">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <p className="text-[14.5px] font-semibold text-emerald-900">
              Nothing structural is blocking this resume
            </p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-emerald-800">
              That makes your constraint targeting, not wording. Point it at employers with a real
              sponsorship record instead of rewriting it again.
            </p>
            <Link
              href="/dashboard/matches"
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-800 underline underline-offset-2"
            >
              Find employers that sponsor <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* ── Mode switch ───────────────────────────────────────────── */}
          <div className="mt-4 flex items-center justify-between">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
              {(["walkthrough", "all"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${
                    mode === m ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {m === "walkthrough" ? "Walk me through it" : `All ${total} findings`}
                </button>
              ))}
            </div>
            {mode === "walkthrough" && !atEnd && (
              <span className="text-[12px] font-medium tabular-nums text-slate-500">
                {index + 1} of {total}
              </span>
            )}
          </div>

          {mode === "walkthrough" ? (
            <>
              {/* Progress */}
              <div className="mt-3 flex gap-1">
                {steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={`Go to finding ${i + 1}: ${s.title}`}
                    onClick={() => setIndex(i)}
                    className={`h-1.5 flex-1 rounded-full transition-opacity ${
                      i <= index ? SEVERITY[s.severity].bar : "bg-slate-200"
                    } ${i === index ? "" : "opacity-60 hover:opacity-100"}`}
                  />
                ))}
              </div>

              {atEnd ? (
                <FinalCard firstMove={data.firstMove ?? ""} steps={steps} onRestart={() => setIndex(0)} />
              ) : (
                <FindingCard step={steps[index]} ordinal={index + 1} />
              )}

              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                  disabled={index === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 disabled:opacity-40 hover:bg-slate-50"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back
                </button>
                {!atEnd && (
                  <button
                    type="button"
                    onClick={() => setIndex((i) => i + 1)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-slate-800"
                  >
                    {index === total - 1 ? "Finish" : "Next"}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="mt-3 space-y-3">
              {steps.map((s, i) => (
                <FindingCard key={s.id} step={s} ordinal={i + 1} compact />
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  )
}

function FindingCard({
  step,
  ordinal,
  compact = false,
}: {
  step: Step
  ordinal: number
  compact?: boolean
}) {
  const sev = SEVERITY[step.severity]
  return (
    <article className={`p-6 ${CARD} ${compact ? "" : "mt-3"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-bold tabular-nums text-slate-400">#{ordinal}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sev.chip}`}>
          {sev.label}
        </span>
      </div>

      <h2 className="mt-2 text-[17.5px] font-bold leading-snug text-slate-900">{step.title}</h2>
      <p className="mt-2.5 text-[14px] leading-relaxed text-slate-700">{step.explanation}</p>

      {step.evidence.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
          <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
            <Quote className="h-3 w-3" aria-hidden /> From your resume
          </p>
          <ul className="mt-2 space-y-1.5">
            {step.evidence.map((e) => (
              <li key={e} className="flex gap-2 text-[13px] leading-relaxed text-slate-700">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY[step.severity].dot}`} />
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5">
        <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wide text-emerald-700">
          <Wrench className="h-3 w-3" aria-hidden /> Do this
        </p>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-emerald-900">{step.doThis}</p>
      </div>

      {step.action && (
        <Link
          href={step.action.href}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-[13px] font-semibold text-slate-800 hover:bg-slate-50"
        >
          {step.action.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </article>
  )
}

function FinalCard({
  firstMove,
  steps,
  onRestart,
}: {
  firstMove: string
  steps: Step[]
  onRestart: () => void
}) {
  return (
    <article className="mt-3 p-6 rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> That is the whole review
      </div>
      <h2 className="mt-2 text-[17.5px] font-bold text-slate-900">Start here</h2>
      {firstMove && <p className="mt-2 text-[14px] leading-relaxed text-slate-700">{firstMove}</p>}

      <div className="mt-4 space-y-1.5">
        {steps.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2.5 text-[13px]">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY[s.severity].dot}`} />
            <span className="text-slate-400 tabular-nums">{i + 1}</span>
            <span className="flex-1 truncate text-slate-700">{s.title}</span>
            {s.action && (
              <Link href={s.action.href} className="shrink-0 font-semibold text-orange-600 hover:underline">
                Fix
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/dashboard/resume/studio"
          className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-orange-700"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Open Studio and start fixing
        </Link>
        <button
          type="button"
          onClick={onRestart}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
        >
          <FileSearch className="h-3.5 w-3.5" aria-hidden /> Read it again
        </button>
      </div>
    </article>
  )
}
