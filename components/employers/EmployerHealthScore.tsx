"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronRight } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import type { CompanyHealthScore, HealthSignal, HealthEvent } from "@/types"

// ── Colour helpers ────────────────────────────────────────────────────────────

const VERDICT_COLOR: Record<string, string> = {
  strong:  "#1D9E75",
  healthy: "#5DCAA5",
  caution: "#EF9F27",
  critical:"#E24B4A",
}

const VERDICT_LABEL: Record<string, string> = {
  strong:  "Strong",
  healthy: "Healthy",
  caution: "Caution",
  critical:"Critical",
}

const EVENT_ICON_COLOR: Record<string, string> = {
  layoff:              "#E24B4A",
  funding:             "#1D9E75",
  executive_departure: "#EF9F27",
  product_launch:      "#3B82F6",
}

function severityColor(s: HealthSignal["severity"]): string {
  if (s === "positive") return "#1D9E75"
  if (s === "warning")  return "#EF9F27"
  if (s === "negative") return "#E24B4A"
  return "#94A3B8"
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return "today"
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}yr ago`
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-[var(--color-border,#E2E8F0)]" />
}

// ── Material icon ─────────────────────────────────────────────────────────────

function MI({ name, style }: { name: string; style?: React.CSSProperties }) {
  return (
    <span
      className="material-icons select-none leading-none"
      style={{ fontSize: 20, ...style }}
      aria-hidden
    >
      {name}
    </span>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-slate-100" />
          <div className="h-5 w-48 rounded bg-slate-100" />
          <div className="h-3 w-40 rounded bg-slate-100" />
        </div>
        <div className="space-y-1.5 text-right">
          <div className="h-12 w-16 rounded bg-slate-100" />
          <div className="h-3 w-20 rounded bg-slate-100" />
        </div>
      </div>
      <div className="h-2 w-full rounded bg-slate-100" />
      <div className="grid grid-cols-4 gap-6">
        {[1,2,3,4].map(i => <div key={i} className="h-12 rounded bg-slate-100" />)}
      </div>
    </div>
  )
}

// ── Risk meter ────────────────────────────────────────────────────────────────

function RiskMeter({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  return (
    <div>
      <div
        className="relative h-2 w-full overflow-hidden"
        style={{ background: "linear-gradient(to right, #E24B4A 0%, #EF9F27 40%, #5DCAA5 70%, #1D9E75 100%)" }}
      >
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${pct}%` }}
        >
          <div className="h-4 w-0.5 bg-[var(--color-text-strong,#0F172A)]" />
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-semibold uppercase tracking-wide">
        <span style={{ color: "#E24B4A" }}>Critical</span>
        <span style={{ color: "#EF9F27" }}>Caution</span>
        <span style={{ color: "#5DCAA5" }}>Healthy</span>
        <span style={{ color: "#1D9E75" }}>Strong</span>
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
  signal: HealthSignal
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 py-2.5 text-left"
      >
        <MI name={signal.icon} style={{ color: severityColor(signal.severity) }} />
        <span className="flex-1 text-[13px] text-[var(--color-text,#334155)]">{signal.title}</span>
        <span
          className="flex-shrink-0 text-[11px] font-bold tabular-nums"
          style={{ color: signal.weight >= 0 ? "#1D9E75" : "#E24B4A" }}
        >
          {signal.weight >= 0 ? "+" : ""}{signal.weight}
        </span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform",
            isOpen && "rotate-90"
          )}
        />
      </button>
      {isOpen && (
        <div className="mb-2 ml-9 space-y-1">
          <p className="text-[12px] leading-relaxed text-[var(--color-text-muted,#64748B)]">
            {signal.detail}
          </p>
          {signal.expandDetail && (
            <p className="text-[11.5px] leading-relaxed text-[var(--color-text-muted,#94A3B8)] italic">
              {signal.expandDetail}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  companyId: string
  companyName?: string
}

export function EmployerHealthScore({ companyId, companyName }: Props) {
  const [data, setData] = useState<CompanyHealthScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [openSignalIdx, setOpenSignalIdx] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/employers/${encodeURIComponent(companyId)}/health-score`)
      .then(r => r.ok ? r.json() : null)
      .then((d: CompanyHealthScore | null) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [companyId])

  useEffect(() => { load() }, [load])

  if (loading) return <Skeleton />
  if (!data) return null

  const color = VERDICT_COLOR[data.verdict] ?? "#EF9F27"

  // TLDR from worst 3 signals
  const worstSignals = [...data.signals]
    .filter(s => s.severity === "negative" || s.severity === "warning")
    .slice(0, 3)
  const tldr = worstSignals.length === 0
    ? `${companyName ?? "This employer"} shows strong health signals across funding, headcount, and employee sentiment.`
    : `Key concerns: ${worstSignals.map(s => s.title.toLowerCase()).join(", ")}.`

  const stats: { label: string; value: string; delta: string | null; deltaGood: boolean | null }[] = [
    {
      label: "Months since funding",
      value: data.monthsSinceFunding != null ? `${data.monthsSinceFunding}mo` : "—",
      delta: data.fundingStage ?? null,
      deltaGood: data.monthsSinceFunding != null && data.monthsSinceFunding <= 18,
    },
    {
      label: "Headcount change",
      value: data.headcountChange12moPct != null
        ? `${data.headcountChange12moPct > 0 ? "+" : ""}${data.headcountChange12moPct.toFixed(0)}%`
        : "—",
      delta: data.headcountTrend,
      deltaGood: data.headcountTrend === "growing" ? true : data.headcountTrend === "contracting" ? false : null,
    },
    {
      label: "Glassdoor rating",
      value: data.glassdoorRating != null ? `${data.glassdoorRating.toFixed(1)}/5` : "—",
      delta: data.glassdoorTrend !== "stable" ? data.glassdoorTrend : null,
      deltaGood: data.glassdoorTrend === "improving" ? true : data.glassdoorTrend === "declining" ? false : null,
    },
    {
      label: "Layoff rounds (1yr)",
      value: data.layoffScore === 25 ? "None" : String(
        data.layoffScore >= 20 ? "1+" : data.layoffScore >= 15 ? "1" : data.layoffScore >= 8 ? "1" : data.layoffScore >= 3 ? "2" : "3+"
      ),
      delta: data.layoffScore === 25 ? "No layoffs" : null,
      deltaGood: data.layoffScore >= 20 ? true : data.layoffScore <= 3 ? false : null,
    },
  ]

  return (
    <div className="space-y-6">

      {/* ── Hero ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
            Employer health score
          </p>
          <p className="mt-1 text-[20px] font-medium leading-snug text-[var(--color-text-strong,#0F172A)]">
            {companyName ?? "This employer"}
          </p>
          {data.fundingStage && (
            <p className="mt-0.5 text-[12px] text-[var(--color-text-muted,#64748B)]">
              {data.fundingStage.replace(/_/g, " ").toUpperCase()}
              {data.fundingAmountUsd ? ` · $${(data.fundingAmountUsd / 1_000_000).toFixed(0)}M raised` : ""}
            </p>
          )}
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-[48px] font-black leading-none tabular-nums" style={{ color }}>
            {data.totalScore}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted,#94A3B8)]">
            Health score
          </p>
          <p className="text-[12px] font-semibold" style={{ color }}>
            {VERDICT_LABEL[data.verdict]}
          </p>
        </div>
      </div>

      <Divider />

      {/* ── TLDR ── */}
      <p className="text-[14px] leading-relaxed text-[var(--color-text-muted,#64748B)]">
        {tldr}
      </p>

      {/* ── Risk meter ── */}
      <RiskMeter score={data.totalScore} />

      <Divider />

      {/* ── Stats row ── */}
      <div className="grid grid-cols-2 gap-x-0 gap-y-4 sm:flex sm:divide-x sm:divide-[var(--color-border,#E2E8F0)]">
        {stats.map(({ label, value, delta, deltaGood }) => (
          <div key={label} className="flex-1 px-0 sm:px-5 first:pl-0 last:pr-0">
            <p className="text-[24px] font-bold tabular-nums leading-none text-[var(--color-text-strong,#0F172A)]">
              {value}
            </p>
            <p className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-text-muted,#94A3B8)]">
              {label}
            </p>
            {delta && (
              <p
                className="mt-0.5 text-[11px] font-medium capitalize"
                style={{
                  color: deltaGood === true ? "#1D9E75" : deltaGood === false ? "#E24B4A" : "#EF9F27",
                }}
              >
                {delta.replace(/_/g, " ")}
              </p>
            )}
          </div>
        ))}
      </div>

      <Divider />

      {/* ── Signals ── */}
      {data.signals.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
            Signal breakdown · tap to expand
          </p>
          <div className="divide-y divide-[var(--color-border,#E2E8F0)]">
            {data.signals.map((s, i) => (
              <SignalRow
                key={s.title}
                signal={s}
                isOpen={openSignalIdx === i}
                onToggle={() => setOpenSignalIdx(openSignalIdx === i ? null : i)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Events timeline ── */}
      {data.events.length > 0 && (
        <>
          <Divider />
          <div>
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
              Recent company events
            </p>
            <div className="space-y-3">
              {data.events.map((ev, i) => (
                <div key={i} className="flex items-start gap-3">
                  <MI
                    name={ev.icon}
                    style={{ color: EVENT_ICON_COLOR[ev.type] ?? "#94A3B8", marginTop: 1 }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--color-text-strong,#0F172A)]">
                      {ev.title}
                    </p>
                    <p className="text-[11.5px] text-[var(--color-text-muted,#64748B)]">{ev.detail}</p>
                  </div>
                  <span className="flex-shrink-0 text-[11px] text-[var(--color-text-muted,#94A3B8)]">
                    {fmtDate(ev.date)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      <Divider />

      {/* ── Footer ── */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)]">
          Sources: WARN Act, Crunchbase, Glassdoor, LinkedIn · Updated {timeAgo(data.lastComputedAt)}
        </p>
        <Link
          href="/dashboard/search"
          className="text-[11px] font-medium text-[var(--color-text-strong,#0F172A)] hover:underline"
        >
          Find healthier employers ↗
        </Link>
      </div>
    </div>
  )
}
