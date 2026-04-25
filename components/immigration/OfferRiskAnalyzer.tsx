"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  BadgeCheck,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  FileQuestion,
  Loader2,
  MapPin,
  Plane,
  ShieldAlert,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  OfferRiskAnalysis,
  OfferRiskInput,
  OfferRiskWorkAuthorizationStatus,
  OfferRiskWorkMode,
} from "@/types"

type FormState = {
  company: string
  jobTitle: string
  location: string
  salary: string
  workAuthorizationStatus: OfferRiskWorkAuthorizationStatus
  needsOptStemSupport: boolean
  needsH1B: boolean
  needsFutureSponsorship: boolean
  offerStartDate: string
  workMode: OfferRiskWorkMode
  sponsorshipStatement: string
}

const DEFAULT_FORM: FormState = {
  company: "",
  jobTitle: "",
  location: "",
  salary: "",
  workAuthorizationStatus: "F1_OPT",
  needsOptStemSupport: true,
  needsH1B: false,
  needsFutureSponsorship: true,
  offerStartDate: "",
  workMode: "hybrid",
  sponsorshipStatement: "",
}

const authOptions: Array<{ value: OfferRiskWorkAuthorizationStatus; label: string }> = [
  { value: "F1_OPT", label: "F-1 OPT" },
  { value: "F1_STEM_OPT", label: "F-1 STEM OPT" },
  { value: "H1B", label: "H-1B" },
  { value: "needs_future_sponsorship", label: "Needs future sponsorship" },
  { value: "citizen_or_gc", label: "Citizen / Green Card" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Not sure" },
]

const workModeOptions: Array<{ value: OfferRiskWorkMode; label: string }> = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "on_site", label: "On-site" },
  { value: "unknown", label: "Not sure" },
]

function riskTone(label: OfferRiskAnalysis["riskLabel"]) {
  switch (label) {
    case "Low":
      return "border-emerald-200 bg-emerald-50 text-emerald-900"
    case "Medium":
      return "border-amber-200 bg-amber-50 text-amber-900"
    case "High":
      return "border-rose-200 bg-rose-50 text-rose-900"
    default:
      return "border-slate-200 bg-slate-50 text-slate-700"
  }
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  )
}

function inputClass() {
  return "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#0052CC]/40 focus:ring-2 focus:ring-[#0052CC]/10"
}

function ResultList({
  title,
  icon: Icon,
  items,
  tone = "slate",
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  items: string[]
  tone?: "green" | "amber" | "rose" | "slate"
}) {
  const color =
    tone === "green"
      ? "text-emerald-600"
      : tone === "amber"
        ? "text-amber-600"
        : tone === "rose"
          ? "text-rose-600"
          : "text-slate-500"

  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn("h-4 w-4", color)} />
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      </div>
      <ul className="space-y-2">
        {items.slice(0, 6).map((item) => (
          <li key={item} className="flex gap-2 text-[13px] leading-5 text-slate-600">
            <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", color.replace("text-", "bg-"))} />
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function OfferRiskAnalyzer() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [analysis, setAnalysis] = useState<OfferRiskAnalysis | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canAnalyze = form.company.trim() && form.jobTitle.trim()

  const salaryNumber = useMemo(() => {
    const digits = form.salary.replace(/[^0-9.]/g, "")
    const value = Number(digits)
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }, [form.salary])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function analyze() {
    if (!canAnalyze) {
      setError("Company and job title are required.")
      return
    }

    setIsLoading(true)
    setError(null)

    const payload: OfferRiskInput = {
      company: form.company.trim(),
      jobTitle: form.jobTitle.trim(),
      location: form.location.trim() || null,
      salary: salaryNumber,
      workAuthorizationStatus: form.workAuthorizationStatus,
      needsOptStemSupport: form.needsOptStemSupport,
      needsH1B: form.needsH1B,
      needsFutureSponsorship: form.needsFutureSponsorship,
      offerStartDate: form.offerStartDate || null,
      workMode: form.workMode,
      sponsorshipStatement: form.sponsorshipStatement.trim() || null,
    }

    try {
      const response = await fetch("/api/offers/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })

      if (!response.ok) throw new Error("Could not analyze this offer yet.")
      const body = (await response.json()) as { analysis?: OfferRiskAnalysis; error?: string }
      if (!body.analysis) throw new Error(body.error ?? "No analysis returned.")
      setAnalysis(body.analysis)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not analyze this offer yet.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="surface-card overflow-hidden rounded-none p-0 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
      <div className="relative overflow-hidden border-b border-indigo-100/70 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.18),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f8fbff_52%,#fff7ed_100%)] px-5 py-6 sm:px-7 sm:py-7">
        <div className="pointer-events-none absolute right-[-70px] top-[-90px] h-56 w-56 rounded-full bg-orange-200/35 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-120px] left-[30%] h-56 w-56 rounded-full bg-indigo-200/35 blur-3xl" />

        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <Link
              href="/dashboard/international"
              className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11.5px] font-semibold text-slate-600 shadow-sm transition hover:bg-white"
            >
              ← International Hub
            </Link>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-900/15">
                <ShieldAlert className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-600">
                  Offer Intelligence
                </p>
                <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
                  Offer Risk Analyzer
                </h2>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
              Paste an offer or HR sponsorship language and get a calm risk readout focused on
              salary alignment, sponsorship history, worksite match, timing, and what to verify next.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
            {[
              ["Salary vs LCA", "bg-emerald-50 text-emerald-800 ring-emerald-200"],
              ["Sponsorship fit", "bg-indigo-50 text-indigo-800 ring-indigo-200"],
              ["HR questions", "bg-amber-50 text-amber-900 ring-amber-200"],
              ["Not legal advice", "bg-white/80 text-slate-700 ring-slate-200"],
            ].map(([label, classes]) => (
              <span
                key={label}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold ring-1",
                  classes
                )}
              >
                {label === "Sponsorship fit" ? (
                  <Plane className="h-3 w-3" />
                ) : label === "Salary vs LCA" ? (
                  <Sparkles className="h-3 w-3" />
                ) : null}
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,0.95fr)_minmax(380px,1fr)]">
        <div className="space-y-4 px-5 py-5 sm:px-7 sm:py-6 xl:border-r xl:border-slate-100">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Step 1
            </p>
            <h3 className="mt-1 text-base font-semibold text-slate-950">Offer facts</h3>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Company">
              <input
                value={form.company}
                onChange={(event) => update("company", event.target.value)}
                placeholder="e.g. Microsoft"
                className={inputClass()}
              />
            </Field>
            <Field label="Job title">
              <input
                value={form.jobTitle}
                onChange={(event) => update("jobTitle", event.target.value)}
                placeholder="e.g. Software Engineer"
                className={inputClass()}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Location">
              <input
                value={form.location}
                onChange={(event) => update("location", event.target.value)}
                placeholder="Seattle, WA"
                className={inputClass()}
              />
            </Field>
            <Field label="Salary">
              <input
                value={form.salary}
                onChange={(event) => update("salary", event.target.value)}
                placeholder="145000"
                inputMode="numeric"
                className={inputClass()}
              />
            </Field>
            <Field label="Offer start date">
              <input
                type="date"
                value={form.offerStartDate}
                onChange={(event) => update("offerStartDate", event.target.value)}
                className={inputClass()}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work authorization status">
              <select
                value={form.workAuthorizationStatus}
                onChange={(event) => update("workAuthorizationStatus", event.target.value as OfferRiskWorkAuthorizationStatus)}
                className={inputClass()}
              >
                {authOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Work mode">
              <select
                value={form.workMode}
                onChange={(event) => update("workMode", event.target.value as OfferRiskWorkMode)}
                className={inputClass()}
              >
                {workModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {[
              ["needsOptStemSupport", "Needs OPT/STEM support"],
              ["needsH1B", "Needs H-1B now"],
              ["needsFutureSponsorship", "Needs future sponsorship"],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => update(key as keyof FormState, !form[key as keyof FormState] as never)}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left text-[12px] font-semibold transition",
                  form[key as keyof FormState]
                    ? "border-indigo-200 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                )}
              >
                {form[key as keyof FormState] ? "✓ " : ""}
                {label}
              </button>
            ))}
          </div>

          <Field label="Sponsorship statement / HR response">
            <textarea
              value={form.sponsorshipStatement}
              onChange={(event) => update("sponsorshipStatement", event.target.value)}
              placeholder="Paste the exact line from the offer, recruiter email, or job posting about sponsorship/work authorization."
              rows={5}
              className={cn(inputClass(), "resize-none")}
            />
          </Field>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={analyze}
            disabled={isLoading || !canAnalyze}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            Analyze offer risk
          </button>
        </div>

        <div className="space-y-4 bg-slate-50/55 px-5 py-5 sm:px-7 sm:py-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Step 2
            </p>
            <h3 className="mt-1 text-base font-semibold text-slate-950">Risk readout</h3>
          </div>
          {analysis ? (
            <>
              <div className={cn("rounded-3xl border p-5", riskTone(analysis.riskLabel))}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] opacity-70">
                      Offer risk
                    </p>
                    <h2 className="mt-2 text-3xl font-bold">{analysis.riskLabel}</h2>
                    <p className="mt-2 max-w-xl text-sm leading-6 opacity-85">{analysis.summary}</p>
                  </div>
                  <div className="rounded-2xl bg-white/70 px-4 py-3 text-right">
                    <p className="text-[11px] font-semibold uppercase tracking-wider opacity-70">Score</p>
                    <p className="text-2xl font-bold">{analysis.riskScore ?? "—"}</p>
                    <p className="text-xs opacity-70">Confidence: {analysis.confidence}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <ResultList title="Key concerns" icon={AlertTriangle} items={analysis.keyConcerns} tone="rose" />
                <ResultList title="Positive signals" icon={BadgeCheck} items={analysis.positiveSignals} tone="green" />
                <ResultList title="Questions to ask HR" icon={FileQuestion} items={analysis.questionsToAskRecruiter} tone="amber" />
                <ResultList title="Documentation checklist" icon={ClipboardCheck} items={analysis.documentationChecklist} />
              </div>

              <div className="rounded-3xl bg-white p-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <Briefcase className="mb-2 h-4 w-4 text-indigo-500" />
                    <p className="text-xs font-semibold text-slate-500">Visa fit</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {analysis.visaFit.label}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <MapPin className="mb-2 h-4 w-4 text-emerald-500" />
                    <p className="text-xs font-semibold text-slate-500">Salary vs LCA</p>
                    <p className="mt-1 text-lg font-semibold text-slate-950">
                      {analysis.salaryIntelligence.comparisonLabel}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <CalendarClock className="mb-2 h-4 w-4 text-amber-500" />
                    <p className="text-xs font-semibold text-slate-500">H-1B timing</p>
                    <p className="mt-1 text-lg font-semibold capitalize text-slate-950">
                      {analysis.h1bTimingRisk}
                    </p>
                  </div>
                </div>
                {analysis.missingData.length > 0 && (
                  <div className="mt-4 rounded-2xl bg-slate-50 p-4">
                    <p className="mb-2 text-sm font-semibold text-slate-800">Data gaps to close</p>
                    <div className="flex flex-wrap gap-2">
                      {analysis.missingData.slice(0, 8).map((item) => (
                        <span key={item} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-900">
                {analysis.disclaimer}
              </p>
            </>
          ) : (
            <div className="flex min-h-[520px] flex-col items-center justify-center rounded-3xl bg-white p-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-xl font-semibold text-slate-950">
                Your offer risk report will appear here
              </h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                Paste the offer facts and any sponsorship language. The analyzer will show concerns, positive signals, HR questions, and a documentation checklist.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
