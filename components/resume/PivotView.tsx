"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { GitBranch, ArrowRight, Plane, Loader2, Sparkles, Building2, Wrench } from "lucide-react"
import { FIELDS, type ResumeSignal } from "@/lib/resume/signal"
import type { BridgePath } from "@/lib/resume/bridge"

type InitResponse = {
  hasResume: boolean
  grounded?: boolean
  signal?: ResumeSignal
  from?: string | null
  bridge?: BridgePath | null
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
  const [bridgeLoading, setBridgeLoading] = useState(false)

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

  function pickTarget(key: string) {
    if (!data?.from) return
    setTo(key)
    setBridge(null)
    setBridgeLoading(true)
    fetch(`/api/resume/bridge?to=${encodeURIComponent(key)}&from=${encodeURIComponent(data.from)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`))))
      .then((d: InitResponse) => setBridge(d.bridge ?? null))
      .catch(() => setBridge(null))
      .finally(() => setBridgeLoading(false))
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

          <p className="text-[12px] text-slate-400">
            Overlap and skills come from what real {bridge.toLabel} jobs ask for; bridge roles are aggregated from the
            live job index. Nothing is invented.
          </p>
        </div>
      )}
    </div>
  )
}
