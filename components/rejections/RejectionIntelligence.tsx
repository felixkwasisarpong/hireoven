"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import type { PatternsResponse } from "@/app/api/rejections/patterns/route"

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  companyId: string
  jobTitle: string
  jobId?: string
}

type ReportForm = {
  applicationStage: string
  outcome: string
  hadReferral: boolean
  appliedWithin48hrs: boolean
  daysToResponse: string
  rejectionReason: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "recently"
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return "today"
  if (days === 1) return "yesterday"
  return `${days}d ago`
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="border-t border-[var(--color-border,#E2E8F0)]" />
}

// ── Material Icon ─────────────────────────────────────────────────────────────

function MI({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={cn("material-icons select-none leading-none", className)} style={style} aria-hidden>
      {name}
    </span>
  )
}

// ── Segmented pills ───────────────────────────────────────────────────────────

function Pills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T | ""
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors",
            value === opt.value
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-[var(--color-border,#E2E8F0)] text-[var(--color-text-muted,#64748B)] hover:border-slate-400"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Yes/No toggle ─────────────────────────────────────────────────────────────

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex gap-2">
      {([true, false] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          className={cn(
            "rounded-full border px-4 py-1.5 text-[12px] font-semibold transition-colors",
            value === v
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-[var(--color-border,#E2E8F0)] text-[var(--color-text-muted,#64748B)] hover:border-slate-400"
          )}
        >
          {v ? "Yes" : "No"}
        </button>
      ))}
    </div>
  )
}

// ── Report modal ──────────────────────────────────────────────────────────────

const STAGES = [
  { value: "applied",      label: "Just applied"  },
  { value: "phone_screen", label: "Phone screen"  },
  { value: "technical",    label: "Technical"     },
  { value: "final",        label: "Final round"   },
  { value: "offer",        label: "Offer stage"   },
] as const

const OUTCOMES = [
  { value: "rejected",      label: "Rejected"    },
  { value: "ghosted",       label: "Ghosted"     },
  { value: "withdrew",      label: "I withdrew"  },
  { value: "offer_received",label: "Got offer"   },
] as const

function ReportModal({
  jobId,
  onClose,
  onSuccess,
}: {
  jobId?: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState<ReportForm>({
    applicationStage: "",
    outcome: "",
    hadReferral: false,
    appliedWithin48hrs: false,
    daysToResponse: "",
    rejectionReason: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const firstEl = useRef<HTMLButtonElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Focus trap + Escape
  useEffect(() => {
    firstEl.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  async function handleSubmit() {
    if (!form.applicationStage || !form.outcome) return
    setSubmitting(true)
    try {
      const res = await fetch("/api/rejections/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          applicationStage: form.applicationStage,
          outcome: form.outcome,
          hadReferral: form.hadReferral,
          appliedWithin48hrs: form.appliedWithin48hrs,
          daysToResponse: form.daysToResponse ? Number(form.daysToResponse) : undefined,
          rejectionReason: form.rejectionReason || undefined,
        }),
      })
      if (res.ok) { setDone(true); setTimeout(onSuccess, 1200) }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Report your outcome"
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="w-full max-w-lg rounded-t-2xl bg-white px-6 pb-8 pt-5 sm:rounded-2xl">
        {/* Handle */}
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />

        <div className="mb-5 flex items-center justify-between">
          <p className="text-[15px] font-semibold text-slate-900">Report your outcome</p>
          <button
            ref={firstEl}
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <MI name="close" className="text-[18px]" />
          </button>
        </div>

        {done ? (
          <div className="py-8 text-center">
            <MI name="check_circle" className="mb-2 text-[40px] text-emerald-500" />
            <p className="text-[15px] font-semibold text-slate-900">Thank you!</p>
            <p className="mt-1 text-[13px] text-slate-500">Your report helps others see the full picture.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Which stage did you reach?
              </p>
              <Pills options={[...STAGES]} value={form.applicationStage as typeof STAGES[number]["value"] | ""} onChange={(v) => setForm(f => ({ ...f, applicationStage: v }))} />
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Outcome</p>
              <Pills options={[...OUTCOMES]} value={form.outcome as typeof OUTCOMES[number]["value"] | ""} onChange={(v) => setForm(f => ({ ...f, outcome: v }))} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Had a referral?</p>
                <YesNo value={form.hadReferral} onChange={(v) => setForm(f => ({ ...f, hadReferral: v }))} />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Applied within 48 hrs?</p>
                <YesNo value={form.appliedWithin48hrs} onChange={(v) => setForm(f => ({ ...f, appliedWithin48hrs: v }))} />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Days until response <span className="font-normal lowercase">(optional)</span>
              </label>
              <input
                type="number"
                min={0}
                placeholder="e.g. 14"
                value={form.daysToResponse}
                onChange={(e) => setForm(f => ({ ...f, daysToResponse: e.target.value }))}
                className="w-full rounded-lg border border-[var(--color-border,#E2E8F0)] px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Any reason given? <span className="font-normal lowercase">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="e.g. Not enough backend experience"
                value={form.rejectionReason}
                onChange={(e) => setForm(f => ({ ...f, rejectionReason: e.target.value }))}
                className="w-full resize-none rounded-lg border border-[var(--color-border,#E2E8F0)] px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-slate-400 focus:outline-none"
              />
            </div>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !form.applicationStage || !form.outcome}
              className="w-full rounded-full bg-slate-900 py-3 text-[13px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              {submitting ? "Submitting…" : "Submit anonymously"}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function RejectionIntelligence({ companyId, jobTitle, jobId }: Props) {
  const [data, setData] = useState<PatternsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    fetch(`/api/rejections/patterns?companyId=${encodeURIComponent(companyId)}&jobTitle=${encodeURIComponent(jobTitle)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: PatternsResponse | null) => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [companyId, jobTitle])

  useEffect(() => { load() }, [load])

  const reportBtn = (
    <button
      type="button"
      onClick={() => setShowModal(true)}
      className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-[var(--color-border,#E2E8F0)] py-3 text-[13px] font-semibold text-[var(--color-text,#334155)] transition hover:border-slate-400 hover:bg-slate-50"
    >
      <MI name="add_circle_outline" className="text-[18px]" />
      Report your outcome — help others see the full picture
    </button>
  )

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="h-3 w-28 rounded bg-slate-100" />
            <div className="h-5 w-52 rounded bg-slate-100" />
            <div className="h-3 w-36 rounded bg-slate-100" />
          </div>
          <div className="h-12 w-16 rounded bg-slate-100" />
        </div>
      </div>
    )
  }

  if (!data) return null

  // ── Insufficient data ──────────────────────────────────────────────────────
  if (data.insufficientData) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
            Rejection intelligence
          </p>
          <p className="mt-1 text-[16px] font-medium text-[var(--color-text-strong,#0F172A)]">
            {data.companyName} · {data.jobTitle || "This role"}
          </p>
        </div>
        <p className="text-[13px] text-[var(--color-text-muted,#64748B)]">
          {data.totalSubmissions === 0
            ? "No data yet for this role. Be the first to report your outcome."
            : `Only ${data.totalSubmissions} report${data.totalSubmissions !== 1 ? "s" : ""} so far — need 10 for patterns. Be the first to add yours.`}
        </p>
        {reportBtn}
        {showModal && (
          <ReportModal jobId={jobId} onClose={() => setShowModal(false)} onSuccess={() => { setShowModal(false); load() }} />
        )}
      </div>
    )
  }

  // ── Full view ──────────────────────────────────────────────────────────────
  const SEVERITY_COLOR: Record<string, string> = {
    positive: "#1D9E75",
    warning:  "#D97706",
    negative: "#DC2626",
  }

  return (
    <div className="space-y-6">

      {/* ── Hero row ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
            Rejection intelligence
          </p>
          <p className="mt-1 text-[20px] font-medium leading-snug text-[var(--color-text-strong,#0F172A)]">
            {data.companyName} · {data.jobTitle || "This role"}
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted,#64748B)]">
            Based on {data.totalSubmissions} applications from this platform
          </p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-[48px] font-black leading-none tabular-nums" style={{ color: "#EF9F27" }}>
            {data.interviewRate}%
          </p>
          <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted,#94A3B8)]">
            Interview rate
          </p>
          <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)]">For your profile type</p>
        </div>
      </div>

      <Divider />

      {/* ── TLDR ── */}
      <p className="text-[14px] leading-relaxed text-[var(--color-text-muted,#64748B)]">
        Out of <strong className="text-[var(--color-text-strong,#0F172A)]">{data.totalSubmissions} applications</strong>, <strong className="text-[var(--color-text-strong,#0F172A)]">{data.interviewRate}%</strong> made it to a phone screen{data.offerRate > 0 ? ` and ${data.offerRate}% received an offer` : ""}{data.medianDaysToResponse ? ` — expect a response in around ${data.medianDaysToResponse} days` : ""}.
      </p>

      <Divider />

      {/* ── Profile match ── */}
      {data.profileMatch.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
            How your profile compares · what got interviews
          </p>
          <div className="mt-3 divide-y divide-[var(--color-border,#E2E8F0)]">
            {data.profileMatch.map((sig) => {
              const iconColor = sig.status === "pass" ? "#1D9E75" : sig.status === "fail" ? "#DC2626" : "#D97706"
              const iconName  = sig.status === "pass" ? "check_circle" : sig.status === "fail" ? "cancel" : "schedule"
              const verdict   = sig.status === "pass" ? "Good signal" : sig.status === "fail" ? "Gap detected" : "Worth noting"
              const verdictColor = sig.status === "pass" ? "#1D9E75" : sig.status === "fail" ? "#DC2626" : "#D97706"
              return (
                <div key={sig.signal} className="flex items-center gap-3 py-2.5">
                  <MI name={sig.icon} className="text-[20px] text-[var(--color-text-muted,#94A3B8)]" />
                  <span className="flex-1 text-[13px] text-[var(--color-text,#334155)]">{sig.signal}</span>
                  <span className="text-[11px] text-[var(--color-text-muted,#94A3B8)]">
                    {sig.percentWhoGotInHadIt}% who screened
                  </span>
                  <div className="flex items-center gap-1">
                    <MI name={iconName} className="text-[18px]" style={{ color: iconColor } as React.CSSProperties} />
                    <span className="text-[11px] font-semibold" style={{ color: verdictColor }}>{verdict}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Divider />

      {/* ── Funnel ── */}
      <div className="space-y-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
          What happened to {data.totalSubmissions} applicants
        </p>
        <div className="mt-3 space-y-2">
          {data.funnel.map((stage, i) => {
            const COLORS = ["#3B82F6","#1D9E75","#F59E0B","#F97316","#DC2626"]
            const bg = COLORS[Math.min(i, COLORS.length - 1)]
            return (
              <div key={stage.stage} className="flex items-center gap-3">
                <span className="w-24 flex-shrink-0 text-[11px] text-[var(--color-text-muted,#64748B)]">
                  {stage.label}
                </span>
                <div className="relative flex-1">
                  <div
                    className="flex h-6 items-center overflow-hidden text-[11px] font-semibold text-white"
                    style={{ width: `${Math.max(8, stage.rate)}%`, background: bg }}
                  >
                    <span className="ml-2 truncate">{stage.count}</span>
                  </div>
                </div>
                <span className="w-10 flex-shrink-0 text-right text-[11px] font-medium tabular-nums text-[var(--color-text-muted,#64748B)]">
                  {stage.rate}%
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <Divider />

      {/* ── Insights ── */}
      {data.insights.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--color-text-muted,#94A3B8)]">
            What moved the needle · from people who got in
          </p>
          <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
            {data.insights.map((ins) => (
              <div key={ins.title} className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <MI
                    name={ins.icon}
                    className="text-[24px]"
                    style={{ color: SEVERITY_COLOR[ins.severity] }}
                  />
                  <p className="mt-0.5 text-[12px] font-bold tabular-nums" style={{ color: SEVERITY_COLOR[ins.severity] }}>
                    {ins.stat}
                  </p>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[var(--color-text-strong,#0F172A)]">{ins.title}</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--color-text-muted,#64748B)]">{ins.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Divider />

      {/* ── Report button ── */}
      {reportBtn}

      {/* ── Footer ── */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[var(--color-text-muted,#94A3B8)]">
          {data.totalSubmissions} anonymised data points · Updated {timeAgo(data.lastUpdated)}
        </p>
        <Link
          href="/dashboard/search"
          className="text-[11px] font-medium text-[var(--color-text-strong,#0F172A)] hover:underline"
        >
          Find better matches ↗
        </Link>
      </div>

      {showModal && (
        <ReportModal
          jobId={jobId}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}
