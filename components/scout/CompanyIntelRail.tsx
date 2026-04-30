"use client"

import Link from "next/link"
import { ArrowUpRight, Loader2, TrendingDown, TrendingUp, Minus } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CompanyIntel, CompanyIntelSummary } from "@/lib/scout/company-intel/types"

// ── Signal badges ─────────────────────────────────────────────────────────────

function SignalBadge({
  label,
  tone,
}: {
  label: string
  tone: "positive" | "warning" | "neutral"
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
        tone === "positive" && "bg-emerald-50 text-emerald-700",
        tone === "warning"  && "bg-amber-50   text-amber-700",
        tone === "neutral"  && "bg-slate-50   text-slate-600",
      )}
    >
      {label}
    </span>
  )
}

function VelocityIcon({ trend }: { trend: "rising" | "stable" | "slowing" | "unknown" | undefined }) {
  if (trend === "rising")  return <TrendingUp   className="h-3.5 w-3.5 text-emerald-500" />
  if (trend === "slowing") return <TrendingDown  className="h-3.5 w-3.5 text-amber-500" />
  return                          <Minus         className="h-3.5 w-3.5 text-slate-400" />
}

// ── Row item ──────────────────────────────────────────────────────────────────

function IntelRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <span className="text-[11px] text-slate-400 flex-shrink-0">{label}</span>
      <div className="text-right min-w-0">
        <p className="text-[12px] font-semibold text-slate-800 leading-4">{value}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Main rail component ───────────────────────────────────────────────────────

type Props = {
  companyId:   string
  companyName: string
  intel:       CompanyIntel | null
  summary:     CompanyIntelSummary | null
  loading?:    boolean
  onClose?:    () => void
}

export function CompanyIntelRail({ companyId, companyName, intel, summary, loading, onClose }: Props) {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col gap-3 xl:w-80">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Company intel</p>
            <p className="mt-0.5 truncate text-sm font-bold text-slate-900">{companyName}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Link
              href={`/dashboard/companies/${companyId}`}
              className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 transition hover:border-slate-950 hover:bg-slate-950 hover:text-white"
            >
              Full profile
              <ArrowUpRight className="h-2.5 w-2.5" />
            </Link>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <span className="sr-only">Close</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 px-4 py-5">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            <p className="text-xs text-slate-400">Loading company signals…</p>
          </div>
        )}

        {/* Signal badges */}
        {!loading && summary && (
          <div className="flex flex-wrap gap-1.5 px-4 pt-3.5 pb-2">
            {summary.sponsorshipLabel && (
              <SignalBadge label={summary.sponsorshipLabel} tone="positive" />
            )}
            {summary.hiringLabel && (
              <SignalBadge label={summary.hiringLabel} tone="positive" />
            )}
            {summary.freshnessLabel && (
              <SignalBadge label={summary.freshnessLabel} tone="warning" />
            )}
            {summary.competitionLabel && (
              <SignalBadge label={summary.competitionLabel} tone="neutral" />
            )}
          </div>
        )}

        {/* Intel rows */}
        {!loading && intel && (
          <div className="divide-y divide-slate-50 px-4 pb-3.5">

            {/* Hiring velocity */}
            {intel.hiringVelocity && intel.hiringVelocity.trend !== "unknown" && (
              <div className="flex items-center justify-between py-2">
                <span className="text-[11px] text-slate-400">Hiring trend</span>
                <div className="flex items-center gap-1.5">
                  <VelocityIcon trend={intel.hiringVelocity.trend} />
                  <span className="text-[12px] font-semibold capitalize text-slate-800">
                    {intel.hiringVelocity.trend}
                  </span>
                </div>
              </div>
            )}

            {/* Sponsorship */}
            {intel.sponsorshipSignals && (
              <div className="py-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">H-1B history</span>
                  <span className={cn(
                    "text-[12px] font-semibold",
                    intel.sponsorshipSignals.h1bHistory ? "text-emerald-600" : "text-slate-500"
                  )}>
                    {intel.sponsorshipSignals.h1bHistory ? "Yes" : "None found"}
                  </span>
                </div>
                {(intel.sponsorshipSignals.confidence ?? 0) > 0 && (
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    Confidence: {Math.round((intel.sponsorshipSignals.confidence ?? 0) * 100)}%
                  </p>
                )}
              </div>
            )}

            {/* Response likelihood */}
            {intel.responseSignals && intel.responseSignals.likelihood !== "unknown" && (
              <IntelRow
                label="Response likelihood"
                value={intel.responseSignals.likelihood.charAt(0).toUpperCase() + intel.responseSignals.likelihood.slice(1)}
              />
            )}

            {/* Freshness */}
            {intel.hiringFreshness && intel.hiringFreshness.freshness !== "unknown" && (
              <IntelRow
                label="Job freshness"
                value={
                  intel.hiringFreshness.freshness === "active" ? "Active" :
                  intel.hiringFreshness.freshness === "mixed"  ? "Mixed" : "Older postings"
                }
                sub={intel.hiringFreshness.evidence?.[0]}
              />
            )}

            {/* Active openings */}
            {summary?.activeOpeningsCount != null && summary.activeOpeningsCount > 0 && (
              <IntelRow
                label="Open roles"
                value={String(summary.activeOpeningsCount)}
                sub="currently active"
              />
            )}

            {/* Interview process */}
            {intel.interviewSignals?.processLength && intel.interviewSignals.processLength !== "unknown" && (
              <IntelRow
                label="Interview process"
                value={intel.interviewSignals.processLength.charAt(0).toUpperCase() + intel.interviewSignals.processLength.slice(1)}
                sub={intel.interviewSignals.commonStages?.[0]}
              />
            )}

            {/* Market position */}
            {intel.marketPosition?.category && (
              <IntelRow label="Sector" value={intel.marketPosition.category} />
            )}
          </div>
        )}

        {/* Cautionary footer */}
        {!loading && intel && (
          <div className="border-t border-slate-50 px-4 py-2.5">
            <p className="text-[10px] leading-4 text-slate-400">
              Signals are evidence-based and phrased cautiously. No guarantees implied.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
