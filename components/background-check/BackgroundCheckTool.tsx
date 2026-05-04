"use client"

import { useEffect, useRef, useState } from "react"
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

const RECORD_TYPE_OPTIONS: { value: RecordType; label: string; icon: string }[] = [
  { value: "criminal_conviction", label: "Criminal conviction", icon: "gavel" },
  { value: "arrest_no_conviction", label: "Arrest without conviction", icon: "handcuffs" },
  { value: "credit_issues", label: "Credit issues", icon: "credit_card_off" },
  { value: "employment_gap", label: "Employment gap 1yr+", icon: "timeline" },
  { value: "dismissed_charges", label: "Dismissed charges", icon: "cancel" },
  { value: "expunged_record", label: "Expunged record", icon: "auto_delete" },
]

const YEARS_AGO_OPTIONS: { value: YearsAgo; label: string }[] = [
  { value: "under_3", label: "Under 3 years" },
  { value: "3_to_7", label: "3–7 years" },
  { value: "7_to_10", label: "7–10 years" },
  { value: "over_10", label: "Over 10 years" },
]

const US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "Washington D.C." },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
]

const INDUSTRY_OPTIONS = [
  { slug: "tech", label: "Technology", icon: "devices" },
  { slug: "finance", label: "Finance / Banking", icon: "account_balance" },
  { slug: "healthcare", label: "Healthcare", icon: "local_hospital" },
  { slug: "retail", label: "Retail / E-commerce", icon: "storefront" },
  { slug: "logistics", label: "Logistics / Warehouse", icon: "local_shipping" },
  { slug: "government", label: "Government", icon: "domain" },
  { slug: "startup", label: "Startup", icon: "rocket_launch" },
  { slug: "education", label: "Education", icon: "school" },
]

const PLEDGE_LABELS: Record<string, string> = {
  fair_chance_pledge: "Fair Chance Pledge",
  ban_the_box: "Ban the Box",
  second_chance: "Second Chance",
}

// ── Outlook config ────────────────────────────────────────────────────────────

const OUTLOOK_CONFIG = {
  strong: { label: "Strong", color: "var(--outlook-strong, #16a34a)", bg: "var(--outlook-strong-bg, #f0fdf4)" },
  moderate: { label: "Moderate", color: "var(--outlook-moderate, #d97706)", bg: "var(--outlook-moderate-bg, #fffbeb)" },
  challenging: { label: "Challenging", color: "var(--outlook-challenging, #ea580c)", bg: "var(--outlook-challenging-bg, #fff7ed)" },
  difficult: { label: "Difficult", color: "var(--outlook-difficult, #dc2626)", bg: "var(--outlook-difficult-bg, #fef2f2)" },
} as const

const SEVERITY_TAG: Record<string, { label: string; className: string }> = {
  protected: { label: "Protected", className: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  partial: { label: "Partial", className: "bg-amber-50 text-amber-700 border border-amber-200" },
  exposed: { label: "Exposed", className: "bg-red-50 text-red-700 border border-red-200" },
}

const RISK_COLOR: Record<string, string> = {
  low: "#16a34a",
  medium: "#d97706",
  high: "#dc2626",
}

// ── Step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ view }: { view: View }) {
  const steps: { id: View; label: string }[] = [
    { id: "intake", label: "Your situation" },
    { id: "results", label: "Your landscape" },
    { id: "employers", label: "Safe companies" },
  ]
  const order: View[] = ["intake", "results", "employers"]
  const currentIdx = order.indexOf(view)

  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((step, idx) => {
        const done = idx < currentIdx
        const active = idx === currentIdx
        return (
          <div key={step.id} className="flex items-center flex-1 min-w-0">
            <div className="flex items-center gap-2 shrink-0">
              {done ? (
                <span className="material-icons text-[18px] text-emerald-600">check_circle</span>
              ) : (
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold border",
                    active
                      ? "border-[var(--color-primary,#2563eb)] bg-[var(--color-primary,#2563eb)] text-white"
                      : "border-slate-300 text-slate-400"
                  )}
                >
                  {idx + 1}
                </span>
              )}
              <span
                className={cn(
                  "text-[13px] whitespace-nowrap",
                  active ? "font-semibold text-slate-900" : done ? "text-emerald-600 font-medium" : "text-slate-400"
                )}
              >
                {step.label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className="flex-1 h-px bg-slate-200 mx-3" />
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
  icon?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium border transition-colors",
        selected
          ? "border-[var(--color-primary,#2563eb)] bg-[var(--color-primary,#2563eb)] text-white"
          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
      )}
    >
      {icon && (
        <span className="material-icons text-[14px] leading-none">{icon}</span>
      )}
      {label}
    </button>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
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
      <div>
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

      <div className="my-6 border-t border-slate-100" />

      {/* Q2 — Years ago */}
      <div>
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

      <div className="my-6 border-t border-slate-100" />

      {/* Q3 — State */}
      <div>
        <SectionLabel>Which state are you searching in?</SectionLabel>
        <div
          className="flex flex-wrap gap-2 overflow-y-auto"
          style={{ maxHeight: "120px" }}
        >
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
            Selected: {US_STATES.find((s) => s.code === intake.stateCode)?.name}
          </p>
        )}
      </div>

      <div className="my-6 border-t border-slate-100" />

      {/* Q4 — Industries */}
      <div>
        <SectionLabel>Which industries are you targeting?</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {INDUSTRY_OPTIONS.map((ind) => (
            <Pill
              key={ind.slug}
              label={ind.label}
              icon={ind.icon}
              selected={intake.industries.includes(ind.slug)}
              onClick={() => toggleIndustry(ind.slug)}
            />
          ))}
        </div>
      </div>

      {/* Privacy note */}
      <div className="mt-8 flex items-start gap-2 text-[13px] text-slate-400">
        <span className="material-icons text-[16px] mt-px">lock</span>
        <span>
          Nothing you enter here is transmitted to any server or stored. Your privacy is the
          foundation of this tool.
        </span>
      </div>

      <div className="mt-6">
        <button
          type="button"
          disabled={!canSubmit || loading}
          onClick={onSubmit}
          className={cn(
            "inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-[14px] font-semibold transition-colors",
            canSubmit && !loading
              ? "bg-[var(--color-primary,#2563eb)] text-white hover:bg-blue-700"
              : "bg-slate-100 text-slate-400 cursor-not-allowed"
          )}
        >
          {loading ? (
            <>
              <span className="material-icons animate-spin text-[16px]">sync</span>
              Analyzing…
            </>
          ) : (
            <>
              Show my landscape
              <span className="material-icons text-[16px]">arrow_forward</span>
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
  const cfg = OUTLOOK_CONFIG[result.outlook]

  const recordSummary =
    intake.recordTypes.length === 1
      ? intake.recordTypes[0].replace(/_/g, " ")
      : `${intake.recordTypes.length} record types`

  const stateName = US_STATES.find((s) => s.code === intake.stateCode)?.name ?? intake.stateCode
  const industriesSummary =
    intake.industries.length === 1
      ? INDUSTRY_OPTIONS.find((i) => i.slug === intake.industries[0])?.label ?? intake.industries[0]
      : `${intake.industries.length} industries`

  return (
    <div>
      {/* Hero */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
            Your hiring landscape
          </p>
          <h1 className="text-[20px] font-bold text-slate-900 leading-snug">
            {recordSummary} · {stateName} · {industriesSummary}
          </h1>
        </div>
        <div
          className="shrink-0 rounded-lg px-4 py-2 text-center"
          style={{ background: cfg.bg, color: cfg.color }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide opacity-70">Outlook</p>
          <p className="text-[18px] font-bold">{cfg.label}</p>
        </div>
      </div>

      {/* TLDR */}
      <p className="text-[15px] text-slate-700 leading-relaxed mb-8">{result.tldr}</p>

      <div className="border-t border-slate-100 mb-6" />

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
                <span
                  className="material-icons text-[20px] mt-0.5 shrink-0"
                  style={{
                    color:
                      item.severity === "protected"
                        ? "#16a34a"
                        : item.severity === "partial"
                          ? "#d97706"
                          : "#dc2626",
                  }}
                >
                  {item.icon}
                </span>
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

      <div className="border-t border-slate-100 mb-6" />

      {/* Industry Breakdown */}
      {result.industryBreakdown.length > 0 && (
        <div className="mb-8">
          <h2 className="text-[15px] font-semibold text-slate-900 mb-4">
            Industry breakdown
          </h2>
          <div className="space-y-4">
            {result.industryBreakdown.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="material-icons text-[20px] mt-0.5 shrink-0 text-slate-500">
                  {item.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mb-1">
                    <span className="text-[14px] font-semibold text-slate-900">{item.label}</span>
                    <span className="text-[12px] text-slate-400">{item.checkDescription}</span>
                  </div>
                  <p
                    className="text-[13px] font-medium"
                    style={{ color: RISK_COLOR[item.severity] }}
                  >
                    {item.verdict}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-slate-100 mb-6" />

      {/* Action Items */}
      <div className="mb-8">
        <h2 className="text-[15px] font-semibold text-slate-900 mb-4">Action items</h2>
        <div className="space-y-4">
          {result.actionItems.map((item, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="material-icons text-[20px] mt-0.5 shrink-0 text-emerald-600">
                {item.icon}
              </span>
              <div>
                <p className="text-[14px] font-semibold text-slate-900 mb-0.5">{item.title}</p>
                <p className="text-[13px] text-slate-600 leading-relaxed">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-slate-100 mb-4" />

      {/* Footer */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-[12px] text-slate-400 leading-relaxed max-w-xl">
          {result.disclaimer}
        </p>
        <button
          type="button"
          onClick={onNext}
          className="shrink-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-primary,#2563eb)] hover:underline"
        >
          Find fair chance employers
          <span className="material-icons text-[15px]">arrow_forward</span>
        </button>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800"
        >
          <span className="material-icons text-[15px]">edit</span>
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
            <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
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
      <h2 className="text-[18px] font-bold text-slate-900 mb-2">Fair chance employers</h2>
      <p className="text-[13px] text-slate-500 mb-6">
        These companies have public fair chance hiring commitments. They actively hire people
        with records.
      </p>

      {employers.length === 0 ? (
        <p className="text-[14px] text-slate-500">No fair chance employers found.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {employers.map((emp) => (
            <div key={emp.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[14px] font-semibold text-slate-900 truncate">
                  {emp.company_name}
                </span>
                {emp.verified && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                    title="Verified pledge source"
                  >
                    <span className="material-icons text-[11px]">verified</span>
                    Verified
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {PLEDGE_LABELS[emp.pledge_type] ?? emp.pledge_type}
                </span>
                {emp.pledge_source_url && (
                  <a
                    href={emp.pledge_source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[var(--color-primary,#2563eb)] hover:underline"
                    title="View pledge"
                  >
                    <span className="material-icons text-[15px]">open_in_new</span>
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
          <span className="material-icons text-[15px]">arrow_back</span>
          Back to landscape
        </button>
        <a
          href="/dashboard/companies"
          className="text-[13px] font-semibold text-[var(--color-primary,#2563eb)] hover:underline"
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
    } catch {
      setEmployersError("Failed to load fair chance employers.")
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
    <>
      {/* Inject Material Icons */}
      <link
        href="https://fonts.googleapis.com/icon?family=Material+Icons"
        rel="stylesheet"
      />

      <div ref={topRef} className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <StepIndicator view={view} />

        {error && view === "intake" && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-[13px] text-red-600">
            {error}
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
    </>
  )
}
