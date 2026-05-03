"use client"

import { useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GhostRiskApiResponse, GhostRiskSignal } from "@/app/api/jobs/[id]/ghost-risk/route"

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  jobId: string
  onSkip?: () => void
  onApply?: () => void
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number | null): string {
  if (score == null) return "var(--color-text-muted, #94A3B8)"
  if (score >= 70) return "#DC2626"
  if (score >= 40) return "#D97706"
  return "#16A34A"
}

function verdict(score: number | null): { emoji: string; title: string; bg: string } {
  if (score == null) return { emoji: "❓", title: "No data yet", bg: "#F8FAFC" }
  if (score >= 70) return { emoji: "👻", title: "Likely a ghost job", bg: "#FEF2F2" }
  if (score >= 40) return { emoji: "⚠️", title: "Proceed with caution", bg: "#FFFBEB" }
  return { emoji: "✅", title: "Looks legitimate", bg: "#F0FDF4" }
}

function dotColor(status: GhostRiskSignal["status"]): string {
  if (status === "red") return "#DC2626"
  if (status === "amber") return "#D97706"
  if (status === "green") return "#16A34A"
  return "#94A3B8"
}

function tldrSummary(signals: GhostRiskSignal[]): string {
  const bad = signals
    .filter((s) => s.status === "red" || s.status === "amber")
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
  if (bad.length === 0) return "All signals look clean — no major ghost job indicators detected."
  const parts = bad.map((s) => s.value.toLowerCase())
  if (parts.length === 1) return `Risk is driven by ${bad[0].name.toLowerCase()}: ${parts[0]}.`
  if (parts.length === 2) return `Top concerns: ${bad[0].name.toLowerCase()} (${parts[0]}) and ${bad[1].name.toLowerCase()} (${parts[1]}).`
  return `Top concerns: ${bad[0].name.toLowerCase()} (${parts[0]}), ${bad[1].name.toLowerCase()} (${parts[1]}), and ${bad[2].name.toLowerCase()}.`
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ms / 3_600_000)
  if (hours < 1) return "just now"
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-[var(--color-border,#E2E8F0)]" />
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-full bg-slate-100" />
          <div className="space-y-2">
            <div className="h-5 w-40 rounded bg-slate-100" />
            <div className="h-3.5 w-56 rounded bg-slate-100" />
          </div>
        </div>
        <div className="space-y-1.5 text-right">
          <div className="h-10 w-14 rounded bg-slate-100" />
          <div className="h-3 w-16 rounded bg-slate-100" />
        </div>
      </div>
      <div className="h-px bg-slate-100" />
      <div className="h-4 w-3/4 rounded bg-slate-100" />
      <div className="h-3 w-full rounded bg-slate-100" />
      <div className="space-y-2.5">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-slate-100" />
              <div className="h-3.5 w-32 rounded bg-slate-100" />
            </div>
            <div className="h-3.5 w-20 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Risk meter ────────────────────────────────────────────────────────────────

function RiskMeter({ score }: { score: number | null }) {
  const pct = score == null ? 50 : Math.max(0, Math.min(100, score))
  return (
    <div>
      <div className="relative h-2 w-full overflow-hidden rounded-none">
        <div
          className="h-full w-full"
          style={{
            background: "linear-gradient(to right, #16A34A 0%, #D97706 50%, #DC2626 100%)",
          }}
        />
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pct}%` }}
        >
          <div className="h-4 w-0.5 bg-[var(--color-text-strong,#0F172A)] shadow-sm" />
        </div>
      </div>
      <div className="mt-1.5 flex justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Safe</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">Risky</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-red-600">Ghost</span>
      </div>
    </div>
  )
}

// ── Signal row ────────────────────────────────────────────────────────────────

function SignalRow({
  signal,
  isOpen,
  onToggle,
}: {
  signal: GhostRiskSignal
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 py-2 text-left"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <span
            className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: dotColor(signal.status) }}
          />
          <span className="truncate text-[13px] text-[var(--color-text,#334155)]">
            {signal.name}
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[13px] font-medium text-[var(--color-text-muted,#64748B)]">
            {signal.value}
          </span>
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform",
              isOpen && "rotate-90"
            )}
          />
        </span>
      </button>
      {isOpen && (
        <p className="mb-2 ml-[18px] pl-2.5 text-[12px] leading-relaxed text-[var(--color-text-muted,#64748B)] border-l border-slate-200">
          {signal.detail}
        </p>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function GhostJobDetector({ jobId, onSkip, onApply }: Props) {
  const [data, setData] = useState<GhostRiskApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [openSignalIdx, setOpenSignalIdx] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/jobs/${encodeURIComponent(jobId)}/ghost-risk`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: GhostRiskApiResponse) => { setData(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [jobId])

  if (loading) return <Skeleton />
  if (error || !data) return null

  const v = verdict(data.riskScore)
  const color = scoreColor(data.riskScore)
  const summary = tldrSummary(data.signals)

  return (
    <div className="space-y-5">

      {/* ── Hero row ── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div
            className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full text-2xl"
            style={{ background: v.bg }}
            aria-hidden
          >
            {v.emoji}
          </div>
          <div className="min-w-0">
            <p className="text-[17px] font-semibold leading-snug text-[var(--color-text-strong,#0F172A)]">
              {v.title}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-[var(--color-text-muted,#64748B)]">
              {data.jobTitle}{data.companyName ? ` · ${data.companyName}` : ""}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <p
            className="text-[40px] font-black leading-none tabular-nums"
            style={{ color }}
          >
            {data.riskScore ?? "—"}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted,#94A3B8)]">
            Risk score
          </p>
        </div>
      </div>

      <Divider />

      {/* ── TLDR ── */}
      <p className="text-[15px] leading-relaxed text-[var(--color-text-muted,#64748B)]">
        {summary}
      </p>

      {/* ── Risk meter ── */}
      <RiskMeter score={data.riskScore} />

      <Divider />

      {/* ── Signals ── */}
      <div>
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--color-text-muted,#94A3B8)]">
          Why · tap to expand
        </p>
        <div className="divide-y divide-[var(--color-border,#E2E8F0)]">
          {data.signals.map((signal, i) => (
            <SignalRow
              key={signal.name}
              signal={signal}
              isOpen={openSignalIdx === i}
              onToggle={() => setOpenSignalIdx(openSignalIdx === i ? null : i)}
            />
          ))}
        </div>
      </div>

      <Divider />

      {/* ── CTA row ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)]">
          Scanned {timeAgo(data.lastScannedAt)} · updates every 24h
        </p>
        <div className="flex items-center gap-2">
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex items-center rounded-full bg-red-50 px-3.5 py-1.5 text-[12px] font-semibold text-red-700 transition hover:bg-red-100"
            >
              Skip this job
            </button>
          )}
          {onApply && (
            <button
              type="button"
              onClick={onApply}
              className="inline-flex items-center rounded-full border border-[var(--color-border,#E2E8F0)] bg-transparent px-3.5 py-1.5 text-[12px] font-semibold text-[var(--color-text,#334155)] transition hover:bg-slate-50"
            >
              Apply anyway
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
