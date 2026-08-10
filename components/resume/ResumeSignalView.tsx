"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Radar, AlertTriangle, Loader2, Plane } from "lucide-react"
import type { ResumeSignal, FieldFit } from "@/lib/resume/signal"

type ApiResponse = { hasResume: boolean; primaryRole?: string | null; grounded?: boolean; signal?: ResumeSignal }

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

export default function ResumeSignalView() {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/resume/signal")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `Failed (${r.status})`)
        return r.json()
      })
      .then((d: ApiResponse) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

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

      {/* Gap toward the runner-up (or primary) — the positioning lever. */}
      {runnerUp && runnerUp.missing.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[15px] font-bold text-slate-900">
            To read more as {runnerUp.label}
          </h2>
          <p className="mt-1 text-[13px] text-slate-500">
            These signals for {runnerUp.label} are missing or buried — surface the ones you honestly have to shift how
            your resume reads.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {runnerUp.missing.map((m) => (
              <span
                key={m}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[12px] font-medium text-slate-600"
              >
                {m}
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="text-[12px] text-slate-400">
        {data.grounded
          ? "Scored against the skills real jobs in each field are asking for right now, with each field's live visa-sponsorship density. Next: generate a positioned resume variant the matcher uses."
          : "v1 heuristic (keyword signatures). Once the field profiles are built from the live job corpus, this switches to scoring against real job demand and shows each field's visa-sponsorship density."}
      </p>
    </div>
  )
}
