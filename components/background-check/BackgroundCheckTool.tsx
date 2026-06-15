"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Gavel,
  Info,
  Lock,
  Pencil,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  GuidanceResult,
  RecordType,
  YearsAgo,
} from "@/lib/background-check/guidance-engine"

// ── Types ────────────────────────────────────────────────────────────────────

type View = "intake" | "results" | "employers"

type IntakeState = {
  recordTypes: RecordType[]
  yearsAgo: YearsAgo | null
  stateCode: string | null
  industries: string[]
}

type FairChanceEmployer = {
  id: string
  company_id: string | null
  company_name: string
  pledge_type: string
  pledge_source_url: string | null
  verified: boolean
  verified_at: string | null
}

// ── Static data ──────────────────────────────────────────────────────────────

const RECORD_TYPE_OPTIONS: { value: RecordType; label: string; icon: React.ReactNode }[] = [
  { value: "criminal_conviction",  label: "Criminal conviction",        icon: <Gavel className="h-3.5 w-3.5" /> },
  { value: "arrest_no_conviction", label: "Arrest without conviction",  icon: <Shield className="h-3.5 w-3.5" /> },
  { value: "credit_issues",        label: "Credit issues",             icon: <CreditCard className="h-3.5 w-3.5" /> },
  { value: "employment_gap",       label: "Employment gap 1yr+",       icon: <CalendarDays className="h-3.5 w-3.5" /> },
  { value: "dismissed_charges",    label: "Dismissed charges",         icon: <XCircle className="h-3.5 w-3.5" /> },
  { value: "expunged_record",      label: "Expunged record",           icon: <Trash2 className="h-3.5 w-3.5" /> },
]

const YEARS_AGO_OPTIONS: { value: YearsAgo; label: string }[] = [
  { value: "under_3", label: "Under 3 years" },
  { value: "3_to_7",  label: "3–7 years" },
  { value: "7_to_10", label: "7–10 years" },
  { value: "over_10", label: "Over 10 years" },
]

const US_STATES = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" }, { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" }, { code: "DC", name: "Washington D.C." },
  { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" },
]

const INDUSTRY_OPTIONS = [
  { slug: "tech",        label: "Technology",        icon: "💻" },
  { slug: "finance",     label: "Finance / Banking", icon: "🏦" },
  { slug: "healthcare",  label: "Healthcare",        icon: "🏥" },
  { slug: "retail",      label: "Retail",            icon: "🛍️" },
  { slug: "logistics",   label: "Logistics",         icon: "🚚" },
  { slug: "government",  label: "Government",        icon: "🏛️" },
  { slug: "startup",     label: "Startup",           icon: "🚀" },
  { slug: "education",   label: "Education",         icon: "🎓" },
]

const PLEDGE_LABELS: Record<string, string> = {
  fair_chance_pledge: "Fair Chance Pledge",
  ban_the_box:        "Ban the Box",
  second_chance:      "Second Chance",
}

// ── Outlook config ────────────────────────────────────────────────────────────

const OUTLOOK_CONFIG = {
  strong:      { label: "Strong",      color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
  moderate:    { label: "Moderate",    color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  challenging: { label: "Challenging", color: "#ea580c", bg: "#fff7ed", border: "#fed7aa" },
  difficult:   { label: "Difficult",   color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
} as const

const SEVERITY_TAG: Record<string, { label: string; className: string }> = {
  protected: { label: "Protected", className: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  partial:   { label: "Partial",   className: "bg-amber-50 text-amber-700 border border-amber-200" },
  exposed:   { label: "Exposed",   className: "bg-red-50 text-red-700 border border-red-200" },
}

const SEVERITY_ICON: Record<string, React.ReactNode> = {
  protected: <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600" />,
  partial:   <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-500" />,
  exposed:   <XCircle className="h-5 w-5 mt-0.5 shrink-0 text-red-500" />,
}

const RISK_COLOR: Record<string, string> = {
  low:    "#16a34a",
  medium: "#d97706",
  high:   "#dc2626",
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ view }: { view: View }) {
  const steps: { id: View; label: string }[] = [
    { id: "intake",    label: "Your situation" },
    { id: "results",   label: "Your landscape" },
    { id: "employers", label: "Safe companies" },
  ]
  const order: View[] = ["intake", "results", "employers"]
  const currentIdx = order.indexOf(view)

  return (
    <div className="mb-8 grid gap-2 sm:flex sm:items-center">
      {steps.map((step, idx) => {
        const done   = idx < currentIdx
        const active = idx === currentIdx
        return (
          <div key={step.id} className="flex min-w-0 flex-1 items-center">
            <div className="flex items-center gap-2 shrink-0">
              {done ? (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-600">
                  <CheckCircle2 className="h-4 w-4 text-white" />
                </div>
              ) : (
                <div
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-bold border-2",
                    active
                      ? "border-orange-500 bg-orange-500 text-white"
                      : "border-slate-200 text-slate-400 bg-white"
                  )}
                >
                  {idx + 1}
                </div>
              )}
              <span
                className={cn(
                  "text-[12.5px] whitespace-nowrap font-medium",
                  active ? "text-slate-900" : done ? "text-emerald-600" : "text-slate-400"
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={cn("mx-3 hidden h-px flex-1 sm:block", done ? "bg-emerald-300" : "bg-slate-200")} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Pill component ────────────────────────────────────────────────────────────

function Pill({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string
  icon?: React.ReactNode
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium border transition-all",
        selected
          ? "border-orange-500 bg-orange-500 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-3">
      {children}
    </p>
  )
}

// ── View 1 — Intake ──────────────────────────────────────────────────────────

function IntakeView({
  intake,
  setIntake,
  onSubmit,
  loading,
}: {
  intake: IntakeState
  setIntake: (s: IntakeState) => void
  onSubmit: () => void
  loading: boolean
}) {
  const canSubmit =
    intake.recordTypes.length > 0 &&
    intake.yearsAgo !== null &&
    intake.stateCode !== null &&
    intake.industries.length > 0

  function toggleRecordType(val: RecordType) {
    const next = intake.recordTypes.includes(val)
      ? intake.recordTypes.filter((r) => r !== val)
      : [...intake.recordTypes, val]
    setIntake({ ...intake, recordTypes: next })
  }

  function toggleIndustry(slug: string) {
    const next = intake.industries.includes(slug)
      ? intake.industries.filter((i) => i !== slug)
      : [...intake.industries, slug]
    setIntake({ ...intake, industries: next })
  }

  return (
    <div>
      <h1 className="text-[22px] font-bold text-slate-900 mb-1">What is your situation?</h1>
      <p className="text-[14px] text-slate-500 mb-8">
        Your answers stay in your browser session and are never stored or logged anywhere.
      </p>

      {/* Q1 — Record type */}
      <div className="mb-6">
        <SectionLabel>What type of record do you have?</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {RECORD_TYPE_OPTIONS.map((opt) => (
            <Pill
              key={opt.value}
              label={opt.label}
              icon={opt.icon}
              selected={intake.recordTypes.includes(opt.value)}
              onClick={() => toggleRecordType(opt.value)}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100" />

      {/* Q2 — Years ago */}
      <div className="my-6">
        <SectionLabel>How long ago?</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {YEARS_AGO_OPTIONS.map((opt) => (
            <Pill
              key={opt.value}
              label={opt.label}
              selected={intake.yearsAgo === opt.value}
              onClick={() => setIntake({ ...intake, yearsAgo: opt.value })}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100" />

      {/* Q3 — State */}
      <div className="my-6">
        <SectionLabel>Which state are you searching in?</SectionLabel>
        <div className="flex flex-wrap gap-2 overflow-y-auto" style={{ maxHeight: "130px" }}>
          {US_STATES.map((s) => (
            <Pill
              key={s.code}
              label={s.code}
              selected={intake.stateCode === s.code}
              onClick={() => setIntake({ ...intake, stateCode: s.code })}
            />
          ))}
        </div>
        {intake.stateCode && (
          <p className="mt-2 text-[13px] text-slate-500">
            Selected: <span className="font-semibold">{US_STATES.find((s) => s.code === intake.stateCode)?.name}</span>
          </p>
        )}
      </div>

      <div className="border-t border-slate-100" />

      {/* Q4 — Industries */}
      <div className="my-6">
        <SectionLabel>Which industries are you targeting?</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {INDUSTRY_OPTIONS.map((ind) => (
            <Pill
              key={ind.slug}
              label={ind.label}
              icon={<span className="text-[14px] leading-none">{ind.icon}</span>}
              selected={intake.industries.includes(ind.slug)}
              onClick={() => toggleIndustry(ind.slug)}
            />
          ))}
        </div>
      </div>

      {/* Privacy note */}
      <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-start gap-2.5 text-[12.5px] text-slate-500">
        <Lock className="h-4 w-4 shrink-0 mt-0.5 text-slate-400" />
        <span>Nothing you enter here is transmitted to any server or stored. Your privacy is the foundation of this tool.</span>
      </div>

      <div className="mt-6">
        <button
          type="button"
          disabled={!canSubmit || loading}
          onClick={onSubmit}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-6 py-3 text-[14px] font-semibold transition-all",
            canSubmit && !loading
              ? "bg-slate-950 text-white shadow-sm hover:bg-slate-800 hover:shadow-md"
              : "bg-slate-100 text-slate-400 cursor-not-allowed"
          )}
        >
          {loading ? (
            <>
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Analyzing…
            </>
          ) : (
            <>
              Show my landscape
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ── View 2 — Results ─────────────────────────────────────────────────────────

function ResultsView({
  intake,
  result,
  onEdit,
  onNext,
}: {
  intake: IntakeState
  result: GuidanceResult
  onEdit: () => void
  onNext: () => void
}) {
  const cfg = OUTLOOK_CONFIG[result.outlook] ?? OUTLOOK_CONFIG.moderate

  const recordSummary =
    intake.recordTypes.length === 1
      ? intake.recordTypes[0].replace(/_/g, " ")
      : `${intake.recordTypes.length} record types`

  const stateName    = US_STATES.find((s) => s.code === intake.stateCode)?.name ?? intake.stateCode
  const industrySummary =
    intake.industries.length === 1
      ? INDUSTRY_OPTIONS.find((i) => i.slug === intake.industries[0])?.label ?? intake.industries[0]
      : `${intake.industries.length} industries`

  return (
    <div>
      {/* Hero */}
      <div
        className="flex items-start justify-between gap-4 mb-6 rounded-2xl border p-5"
        style={{ background: cfg.bg, borderColor: cfg.border }}
      >
        <div className="min-w-0">
          <p className="text-[11.5px] font-bold uppercase tracking-wide mb-1" style={{ color: cfg.color, opacity: 0.7 }}>
            Your hiring landscape
          </p>
          <h1 className="text-[18px] font-bold text-slate-900 leading-snug">
            {recordSummary} · {stateName} · {industrySummary}
          </h1>
        </div>
        <div
          className="shrink-0 rounded-xl px-4 py-2 text-center border"
          style={{ background: "white", borderColor: cfg.border }}
        >
          <p className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: cfg.color, opacity: 0.7 }}>Outlook</p>
          <p className="text-[18px] font-bold" style={{ color: cfg.color }}>{cfg.label}</p>
        </div>
      </div>

      {/* TLDR */}
      <p className="text-[15px] text-slate-700 leading-relaxed mb-8">{result.tldr}</p>

      <div className="border-t border-slate-100 mb-7" />

      {/* State Protections */}
      <div className="mb-8">
        <h2 className="text-[15px] font-semibold text-slate-900 mb-4">
          State protections · {stateName}
        </h2>
        <div className="space-y-4">
          {result.stateProtections.map((item, i) => {
            const tag = SEVERITY_TAG[item.severity]
            return (
              <div key={i} className="flex items-start gap-3">
                {SEVERITY_ICON[item.severity] ?? <Info className="h-5 w-5 mt-0.5 shrink-0 text-slate-400" />}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[14px] font-semibold text-slate-900">{item.title}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tag.className)}>
                      {tag.label}
                    </span>
                  </div>
                  <p className="text-[13px] text-slate-600 leading-relaxed">{item.detail}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="border-t border-slate-100 mb-7" />

      {/* Industry Breakdown */}
      {result.industryBreakdown.length > 0 && (
        <div className="mb-8">
          <h2 className="text-[15px] font-semibold text-slate-900 mb-4">Industry breakdown</h2>
          <div className="space-y-4">
            {result.industryBreakdown.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[18px]">
                  {INDUSTRY_OPTIONS.find((o) => o.label === item.label)?.icon ?? "🏢"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-0.5">
                    <span className="text-[14px] font-semibold text-slate-900">{item.label}</span>
                    <span className="text-[12px] text-slate-400">{item.checkDescription}</span>
                  </div>
                  <p className="text-[13px] font-semibold" style={{ color: RISK_COLOR[item.severity] }}>
                    {item.verdict}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 mb-7" />

      {/* Action Items */}
      <div className="mb-8">
        <h2 className="text-[15px] font-semibold text-slate-900 mb-4">Action items</h2>
        <div className="space-y-3">
          {result.actionItems.map((item, i) => (
            <div key={i} className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-[14px] font-semibold text-slate-900 mb-0.5">{item.title}</p>
                <p className="text-[13px] text-slate-600 leading-relaxed">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100 mb-5" />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-[12px] text-slate-400 leading-relaxed max-w-xl">{result.disclaimer}</p>
        <button
          type="button"
          onClick={onNext}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-slate-800 transition-colors"
        >
          <Users className="h-3.5 w-3.5" />
          Find fair chance employers
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-5">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit my situation
        </button>
      </div>
    </div>
  )
}

// ── View 3 — Fair chance employers ───────────────────────────────────────────

function EmployersView({
  employers,
  loading,
  error,
  onBack,
}: {
  employers: FairChanceEmployer[]
  loading: boolean
  error: string | null
  onBack: () => void
}) {
  if (loading) {
    return (
      <div>
        <h2 className="text-[18px] font-bold text-slate-900 mb-6">Fair chance employers</h2>
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <h2 className="text-[18px] font-bold text-slate-900 mb-4">Fair chance employers</h2>
        <p className="text-[14px] text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[18px] font-bold text-slate-900 mb-1">Fair chance employers</h2>
        <p className="text-[13px] text-slate-500">
          These companies have public fair chance hiring commitments. They actively hire people with records.
        </p>
      </div>

      {employers.length === 0 ? (
        <p className="text-[14px] text-slate-500">No fair chance employers found.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
          {employers.map((emp) => (
            <div key={emp.id} className="flex items-center justify-between gap-3 px-4 py-3.5">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                  <ShieldCheck className="h-4 w-4 text-slate-500" />
                </div>
                <div className="min-w-0">
                  <span className="text-[14px] font-semibold text-slate-900 truncate block">
                    {emp.company_name}
                  </span>
                  {emp.verified && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                      <BadgeCheck className="h-3 w-3" />
                      Verified pledge
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11.5px] font-medium text-slate-600">
                  {PLEDGE_LABELS[emp.pledge_type] ?? emp.pledge_type}
                </span>
                {emp.pledge_source_url && (
                  <a
                    href={emp.pledge_source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-orange-600"
                    title="View pledge"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to landscape
        </button>
        <a
          href="/dashboard/companies"
          className="text-[13px] font-semibold text-orange-700 hover:underline"
        >
          View all fair chance employers →
        </a>
      </div>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export default function BackgroundCheckTool() {
  const [view, setView] = useState<View>("intake")
  const [intake, setIntake] = useState<IntakeState>({
    recordTypes: [],
    yearsAgo: null,
    stateCode: null,
    industries: [],
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GuidanceResult | null>(null)
  const [employers, setEmployers] = useState<FairChanceEmployer[]>([])
  const [employersLoading, setEmployersLoading] = useState(false)
  const [employersError, setEmployersError] = useState<string | null>(null)
  const topRef = useRef<HTMLDivElement>(null)

  function scrollTop() {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  async function handleSubmit() {
    if (!intake.stateCode || !intake.yearsAgo) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/background-check/guidance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordTypes: intake.recordTypes,
          yearsAgo: intake.yearsAgo,
          stateCode: intake.stateCode,
          industries: intake.industries,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as GuidanceResult
      setResult(data)
      setView("results")
      scrollTop()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function loadEmployers() {
    setEmployersLoading(true)
    setEmployersError(null)
    try {
      const params = new URLSearchParams()
      if (intake.stateCode) params.set("stateCode", intake.stateCode)
      const res = await fetch(`/api/background-check/fair-chance-employers?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { employers: FairChanceEmployer[] }
      setEmployers(data.employers ?? [])
    } catch (err) {
      console.error("[fair-chance-employers] load error:", err)
      const msg = err instanceof Error ? err.message : String(err)
      setEmployersError(`Failed to load fair chance employers. (${msg})`)
    } finally {
      setEmployersLoading(false)
    }
  }

  function goToEmployers() {
    setView("employers")
    scrollTop()
    if (employers.length === 0 && !employersLoading) {
      loadEmployers()
    }
  }

  return (
    <div ref={topRef} className="w-full pb-12">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
        <StepIndicator view={view} />

        {error && view === "intake" && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <X className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-[13px] text-red-600">{error}</p>
          </div>
        )}

        {view === "intake" && (
          <IntakeView
            intake={intake}
            setIntake={setIntake}
            onSubmit={handleSubmit}
            loading={loading}
          />
        )}

        {view === "results" && result && (
          <ResultsView
            intake={intake}
            result={result}
            onEdit={() => { setView("intake"); scrollTop() }}
            onNext={goToEmployers}
          />
        )}

        {view === "employers" && (
          <EmployersView
            employers={employers}
            loading={employersLoading}
            error={employersError}
            onBack={() => { setView("results"); scrollTop() }}
          />
        )}
      </div>
    </div>
  )
}
