"use client"

import { useEffect, useState, type ReactNode } from "react"
import Link from "next/link"
import { Radar, AlertTriangle, Loader2, Plane, Target, ArrowUp, Sparkles, Check } from "lucide-react"
import type { ResumeSignal, FieldFit, PositioningBrief } from "@/lib/resume/signal"

type ApiResponse = {
  hasResume: boolean
  primaryRole?: string | null
  grounded?: boolean
  signal?: ResumeSignal
  brief?: PositioningBrief | null
  targetField?: string | null
}

function pct(x?: number): number | null {
  return typeof x === "number" ? Math.round(x * 100) : null
}

function Bar({ f, top }: { f: FieldFit; top: boolean }) {
  const color = top ? "#059669" : f.score >= 50 ? "#f59e0b" : "#94a3b8"
  const sponsor = pct(f.sponsorshipShare)
  return (
    <div>
      <div className="flex items-center justify-between text-[13px]">
        <span className={`font-semibold ${top ? "text-slate-900" : "text-slate-600"}`}>{f.label}</span>
        <span className="flex items-center gap-2">
          {sponsor !== null && (
            <span
              className="text-[11px] font-medium tabular-nums text-indigo-600"
              title="Share of this field's live US openings at employers that sponsor work visas"
            >
              {sponsor}% sponsor
            </span>
          )}
          <span className="font-bold tabular-nums" style={{ color }}>
            {f.score}%
          </span>
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${f.score}%`, background: color }} />
      </div>
    </div>
  )
}

const TONES: Record<string, string> = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  slate: "border-slate-200 bg-slate-50 text-slate-600",
}

function BriefBlock({
  icon,
  title,
  hint,
  items,
  tone,
}: {
  icon: ReactNode
  title: string
  hint: string
  items: string[]
  tone: keyof typeof TONES
}) {
  return (
    <div>
      <h3 className="flex items-center gap-1.5 text-[13.5px] font-bold text-slate-900">
        {icon} {title}
      </h3>
      <p className="mt-0.5 text-[12px] text-slate-500">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((s) => (
          <span key={s} className={`rounded-full border px-2.5 py-1 text-[12px] font-medium capitalize ${TONES[tone]}`}>
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function ResumeSignalView() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [brief, setBrief] = useState<PositioningBrief | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)
  const [savedTarget, setSavedTarget] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/resume/signal")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Failed (${r.status})`)
        return r.json()
      })
      .then((d: ApiResponse) => {
        if (!alive) return
        setData(d)
        setSavedTarget(d.targetField ?? null)
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  function pickTarget(key: string) {
    setTarget(key)
    setBrief(null)
    setBriefLoading(true)
    fetch(`/api/resume/signal?target=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d: ApiResponse) => setBrief(d.brief ?? null))
      .catch(() => setBrief(null))
      .finally(() => setBriefLoading(false))
  }

  // Save (or clear) the chosen lane. This bumps the resume's updated_at server-
  // side, so the matcher re-scores the feed with the new positioning.
  function saveTarget(key: string | null) {
    setSaving(true)
    setSaveError(null)
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
      .then(() => setSavedTarget(key))
      // Swallowing this made a failed save look identical to a successful one —
      // the single most likely reason positioning felt like a no-op.
      .catch((e: Error) => setSaveError(e.message))
      .finally(() => setSaving(false))
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Reading your resume&apos;s signal…
      </div>
    )
  }
  if (error) {
    return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>
  }
  if (!data?.hasResume || !data.signal) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
        <p className="text-[15px] font-semibold text-slate-800">No parsed resume yet</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-500">
          Upload a resume and we&apos;ll show you which field it&apos;s actually signalling.
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

  const { signal } = data
  const primary = signal.primary
  const runnerUp = signal.runnerUp

  // Visa edge: when both top fields have corpus-derived sponsorship density and
  // one is meaningfully higher, name the lane with the better sponsorship odds.
  const pS = primary?.sponsorshipShare
  const rS = runnerUp?.sponsorshipShare
  const hasVisaData = typeof pS === "number" && typeof rS === "number"
  const visaLean = hasVisaData && Math.abs(pS - rS) >= 0.08 ? (rS > pS ? runnerUp : primary) : null

  return (
    <div className="space-y-6">
      <header>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <Radar className="h-3.5 w-3.5" /> Resume signal
        </span>
        <h1 className="mt-3 text-[22px] font-bold text-slate-900">What your resume is signalling</h1>
        <p className="mt-1 text-[14px] text-slate-600">
          This is the field an employer&apos;s ATS reads first — before it ever matches you to a job.
          {primary && (
            <>
              {" "}Right now it reads strongest as{" "}
              <strong className="text-slate-900">{primary.label}</strong>.
            </>
          )}
        </p>
      </header>

      {signal.split && primary && runnerUp && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-[13.5px] text-amber-900">
            <strong>Split signal.</strong> Your resume reads almost equally as {primary.label} and {runnerUp.label}.
            Recruiters and ATS filters reward a clear lane — pick your target field and tilt the resume toward it, or
            keep a positioned variant for each.
            {visaLean && (
              <>
                {" "}
                <strong>Visa edge:</strong> {visaLean.label} is the stronger lane for sponsorship —{" "}
                {pct(visaLean.sponsorshipShare)}% of its live US openings sponsor work visas
                {visaLean === runnerUp
                  ? ` vs ${pct(primary.sponsorshipShare)}% for ${primary.label}, so tilting toward it improves your odds.`
                  : ` vs ${pct(runnerUp.sponsorshipShare)}% for ${runnerUp.label} — and it's already your strongest read.`}
              </>
            )}
          </p>
        </div>
      )}

      {/* Visa edge when the signal is clear (not split) — the sponsorship density
          of the field the resume already reads as. */}
      {!signal.split && primary && typeof primary.sponsorshipShare === "number" && (
        <div className="flex items-start gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <Plane className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
          <p className="text-[13.5px] text-indigo-900">
            <strong>Visa edge.</strong> {pct(primary.sponsorshipShare)}% of live US {primary.label} openings are at
            employers that sponsor work visas — that&apos;s the sponsorship density of the lane your resume reads as.
          </p>
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.16em] text-slate-400">Field fit</h2>
        <div className="mt-4 space-y-3.5">
          {signal.fields.slice(0, 8).map((f, i) => (
            <Bar key={f.key} f={f} top={i === 0} />
          ))}
        </div>
      </section>

      {/* Positioning brief — pick a lane, get honest, resume-grounded edits. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-900">
          <Target className="h-4 w-4 text-emerald-600" /> Position for a field
        </h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Pick the lane you want to be read as. We&apos;ll show what to lead with, honest signals you have but
          haven&apos;t surfaced, and the real gaps to close — all from your own resume.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {signal.fields.slice(0, 5).map((f) => {
            const active = target === f.key
            const sponsor = pct(f.sponsorshipShare)
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => pickTarget(f.key)}
                className={`inline-flex items-center rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${
                  active
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-700"
                }`}
              >
                {savedTarget === f.key && (
                  <Check className={`mr-1 h-3.5 w-3.5 ${active ? "text-white" : "text-emerald-600"}`} />
                )}
                {f.label}
                {sponsor !== null && (
                  <span className={`ml-1.5 text-[11px] font-medium ${active ? "text-emerald-100" : "text-indigo-500"}`}>
                    {sponsor}% sponsor
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {briefLoading && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Building your positioning brief…
          </div>
        )}

        {brief && !briefLoading && (
          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13px] text-slate-600">
                As <strong className="text-slate-900">{brief.targetLabel}</strong>, your resume reads at{" "}
                <strong className="text-slate-900">{brief.score}%</strong> of the field&apos;s demand.
              </span>
              {pct(brief.sponsorshipShare) !== null && (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-indigo-600">
                  <Plane className="h-3.5 w-3.5" /> {pct(brief.sponsorshipShare)}% of these openings sponsor visas
                </span>
              )}
            </div>

            {/* Make the matcher use this lane. Persists the field and re-scores
                the feed toward it. */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
              {savedTarget === brief.targetKey ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700">
                    <Check className="h-4 w-4" /> Matching your feed as {brief.targetLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => saveTarget(null)}
                    disabled={saving}
                    className="ml-auto text-[12px] font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700 disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Clear"}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-[13px] text-emerald-900">
                    Match my feed as <strong>{brief.targetLabel}</strong> — boosts jobs in this lane the next time your
                    matches refresh.
                  </span>
                  <button
                    type="button"
                    onClick={() => saveTarget(brief.targetKey)}
                    disabled={saving}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-3.5 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Target className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Use this lane"}
                  </button>
                </>
              )}
            </div>

            {saveError && (
              <p className="mt-2 text-[12.5px] font-medium text-rose-700">
                Couldn&apos;t save that lane: {saveError}
              </p>
            )}

            {brief.leadWith.length > 0 && (
              <BriefBlock
                icon={<Sparkles className="h-4 w-4 text-emerald-600" />}
                title="Lead with"
                hint="You clearly have these — put them up top so the ATS reads them first."
                items={brief.leadWith}
                tone="emerald"
              />
            )}
            {brief.surface.length > 0 && (
              <BriefBlock
                icon={<ArrowUp className="h-4 w-4 text-amber-600" />}
                title="Surface these — you have them, but they're buried"
                hint="Found in your resume text but not in your summary or skills — pull them up."
                items={brief.surface}
                tone="amber"
              />
            )}
            {brief.closeGaps.length > 0 && (
              <BriefBlock
                icon={<Target className="h-4 w-4 text-slate-500" />}
                title="Close these gaps"
                hint="In-demand for this field and not in your resume — add the ones you honestly have."
                items={brief.closeGaps}
                tone="slate"
              />
            )}
            {brief.leadWith.length === 0 && brief.surface.length === 0 && (
              <p className="text-[13px] text-slate-500">
                Your resume shows little signal for {brief.targetLabel} yet — the gaps above are where to start if this
                is your target lane.
              </p>
            )}
          </div>
        )}
      </section>

      <p className="text-[12px] text-slate-400">
        {data.grounded
          ? "Scored against the skills real jobs in each field are asking for right now, with each field's live visa-sponsorship density. Every brief item is drawn from your own resume or the field's real demand — nothing is invented."
          : "v1 heuristic (keyword signatures). Once the field profiles are built from the live job corpus, this switches to scoring against real job demand and shows each field's visa-sponsorship density."}
      </p>
    </div>
  )
}
