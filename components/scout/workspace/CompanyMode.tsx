"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  Building2,
  Loader2,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { CompanyIntel, CompanyIntelSummary } from "@/lib/scout/company-intel/types"

type CompanyIntelResponse = {
  intel:       CompanyIntel
  summary:     CompanyIntelSummary
  companyName: string
}

type Props = {
  companyId:   string
  companyName?: string
  onFollowUp:  (query: string) => void
}

function TrendIcon({ trend }: { trend: "rising" | "stable" | "slowing" | "unknown" | undefined }) {
  if (trend === "rising")  return <TrendingUp  className="h-4 w-4 text-emerald-500" />
  if (trend === "slowing") return <TrendingDown className="h-4 w-4 text-amber-500" />
  return                          <Minus        className="h-4 w-4 text-slate-400" />
}

function SignalPill({ text, tone }: { text: string; tone: "ok" | "warn" | "neutral" }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold",
      tone === "ok"      && "bg-emerald-50 text-emerald-700",
      tone === "warn"    && "bg-amber-50   text-amber-700",
      tone === "neutral" && "bg-slate-100  text-slate-600",
    )}>
      {text}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</p>
      {children}
    </div>
  )
}

export function CompanyMode({ companyId, companyName: nameProp, onFollowUp }: Props) {
  const [data,    setData]    = useState<CompanyIntelResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/scout/company-intel/${companyId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load company intel")
        const json = (await res.json()) as CompanyIntelResponse
        setData(json)
      })
      .catch(() => setError("Could not load company intelligence."))
      .finally(() => setLoading(false))
  }, [companyId])

  const name = data?.companyName ?? nameProp ?? "Company"
  const intel = data?.intel
  const summary = data?.summary

  const followUpChips = [
    `Does ${name} sponsor H-1B visas?`,
    `What roles does ${name} hire for?`,
    `How competitive is applying to ${name}?`,
  ]

  return (
    <div className="space-y-6">

      {/* Mode header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-slate-950">
            <Building2 className="h-3.5 w-3.5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">{name}</p>
            {intel?.marketPosition?.category && (
              <p className="text-xs text-gray-400">{intel.marketPosition.category}</p>
            )}
          </div>
        </div>
        <Link
          href={`/dashboard/companies/${companyId}`}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
        >
          Full profile <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-5">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          <p className="text-sm text-slate-500">Loading company signals…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Intel grid */}
      {!loading && intel && summary && (
        <div className="grid gap-4 sm:grid-cols-2">

          {/* Sponsorship */}
          <Section title="Sponsorship">
            <div className="space-y-2 rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">H-1B history</span>
                <span className={cn(
                  "text-sm font-bold",
                  intel.sponsorshipSignals?.h1bHistory ? "text-emerald-600" : "text-slate-400"
                )}>
                  {intel.sponsorshipSignals?.h1bHistory ? "Yes" : "None found"}
                </span>
              </div>
              {(intel.sponsorshipSignals?.confidence ?? 0) > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Confidence</span>
                  <span className="text-sm font-semibold text-slate-700">
                    {Math.round((intel.sponsorshipSignals!.confidence ?? 0) * 100)}%
                  </span>
                </div>
              )}
              {(intel.sponsorshipSignals?.likelySponsorsRoles?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1 text-[10px] text-slate-400">Common sponsored roles</p>
                  <div className="flex flex-wrap gap-1">
                    {intel.sponsorshipSignals!.likelySponsorsRoles!.slice(0, 3).map((r) => (
                      <span key={r} className="rounded bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">{r}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* Hiring velocity */}
          <Section title="Hiring activity">
            <div className="space-y-2 rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Trend</span>
                <div className="flex items-center gap-1.5">
                  <TrendIcon trend={intel.hiringVelocity?.trend ?? "unknown"} />
                  <span className="text-sm font-bold capitalize text-slate-800">
                    {intel.hiringVelocity?.trend ?? "Unknown"}
                  </span>
                </div>
              </div>
              {(intel.hiringVelocity?.evidence?.length ?? 0) > 0 && (
                <ul className="space-y-1 text-[11px] text-slate-400">
                  {intel.hiringVelocity!.evidence!.slice(0, 2).map((e, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-slate-300" />
                      {e}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          {/* Job freshness */}
          <Section title="Job freshness">
            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Status</span>
                <span className={cn(
                  "text-sm font-bold capitalize",
                  intel.hiringFreshness?.freshness === "active" ? "text-emerald-600" :
                  intel.hiringFreshness?.freshness === "stale"  ? "text-amber-600"   : "text-slate-600"
                )}>
                  {intel.hiringFreshness?.freshness ?? "Unknown"}
                </span>
              </div>
              {(intel.hiringFreshness?.evidence?.length ?? 0) > 0 && (
                <p className="mt-2 text-[11px] text-slate-400">
                  {intel.hiringFreshness!.evidence![0]}
                </p>
              )}
            </div>
          </Section>

          {/* Response signals */}
          <Section title="Response likelihood">
            <div className="rounded-xl border border-slate-100 bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">Estimated</span>
                <span className={cn(
                  "text-sm font-bold capitalize",
                  intel.responseSignals?.likelihood === "high"   ? "text-emerald-600" :
                  intel.responseSignals?.likelihood === "medium" ? "text-amber-600"   :
                  intel.responseSignals?.likelihood === "low"    ? "text-red-500"     : "text-slate-400"
                )}>
                  {intel.responseSignals?.likelihood ?? "Unknown"}
                </span>
              </div>
              {(intel.responseSignals?.reasons?.length ?? 0) > 0 && (
                <p className="mt-2 text-[11px] text-slate-400">
                  {intel.responseSignals!.reasons![0]}
                </p>
              )}
            </div>
          </Section>
        </div>
      )}

      {/* Signal badges strip */}
      {!loading && summary && (
        <Section title="Key signals">
          <div className="flex flex-wrap gap-2">
            {summary.sponsorshipLabel  && <SignalPill text={summary.sponsorshipLabel}  tone="ok" />}
            {summary.hiringLabel       && <SignalPill text={summary.hiringLabel}        tone="ok" />}
            {summary.freshnessLabel    && <SignalPill text={summary.freshnessLabel}     tone="warn" />}
            {summary.competitionLabel  && <SignalPill text={summary.competitionLabel}   tone="neutral" />}
          </div>
        </Section>
      )}

      {/* Conversational evidence */}
      {!loading && (summary?.conversationalSignals?.length ?? 0) > 0 && (
        <Section title="Evidence">
          <ul className="space-y-1.5 text-xs leading-5 text-slate-500">
            {summary!.conversationalSignals.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-slate-300" />
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[10px] text-slate-300">
            All signals are evidence-based. No guarantees of sponsorship or response.
          </p>
        </Section>
      )}

      {/* Follow-up chips */}
      <div className="flex flex-wrap gap-2">
        {followUpChips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => onFollowUp(chip)}
            className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-500 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  )
}
