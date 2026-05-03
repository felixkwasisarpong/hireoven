"use client"

import { KeyboardEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Briefcase, Globe2, Sparkles, Check, Search } from "lucide-react"
import HireovenLogo from "@/components/ui/HireovenLogo"
import CompanyLogo from "@/components/ui/CompanyLogo"
import type { Company, SeniorityLevel, VisaStatus } from "@/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StepOneData {
  roles: string[]
  locations: string[]
  remoteOnly: boolean
  seniority: SeniorityLevel[]
}

interface StepTwoData {
  isInternational: boolean
  visaStatus: VisaStatus | ""
  optEndDate: string
  needsSponsorship: boolean
}

interface StepThreeData {
  selectedCompanyIds: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENIORITY_OPTIONS: { value: SeniorityLevel; label: string }[] = [
  { value: "intern", label: "Intern" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid-level" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff" },
  { value: "principal", label: "Principal / Lead" },
  { value: "director", label: "Director" },
]

const VISA_OPTIONS: { value: VisaStatus; label: string }[] = [
  { value: "opt", label: "OPT (Optional Practical Training)" },
  { value: "stem_opt", label: "STEM OPT Extension" },
  { value: "h1b", label: "H-1B" },
  { value: "green_card", label: "Green Card (Permanent Resident)" },
  { value: "citizen", label: "US Citizen" },
  { value: "other", label: "Other / Not sure" },
]

const STEP_META: { title: string; icon: typeof Briefcase }[] = [
  { title: "Preferences", icon: Briefcase },
  { title: "Eligibility", icon: Globe2 },
  { title: "Watchlist", icon: Sparkles },
]

const TOTAL_STEPS = STEP_META.length
const MAX_COMPANIES = 20

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)

  const [stepOne, setStepOne] = useState<StepOneData>({
    roles: [],
    locations: [],
    remoteOnly: false,
    seniority: [],
  })

  const [stepTwo, setStepTwo] = useState<StepTwoData>({
    isInternational: false,
    visaStatus: "",
    optEndDate: "",
    needsSponsorship: false,
  })

  const [stepThree, setStepThree] = useState<StepThreeData>({
    selectedCompanyIds: [],
  })

  function next() {
    setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  }

  function back() {
    setStep((s) => Math.max(s - 1, 1))
  }

  async function handleFinish() {
    setSaving(true)

    const profileRes = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        desired_roles: stepOne.roles,
        desired_locations: stepOne.remoteOnly ? ["Remote"] : stepOne.locations,
        desired_seniority: stepOne.seniority,
        remote_only: stepOne.remoteOnly,
        is_international: stepTwo.isInternational,
        visa_status: stepTwo.visaStatus || null,
        opt_end_date: stepTwo.optEndDate || null,
        needs_sponsorship: stepTwo.needsSponsorship,
      }),
    })
    if (!profileRes.ok) {
      router.push("/login")
      return
    }

    await Promise.all(
      stepThree.selectedCompanyIds.map((companyId) =>
        fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        })
      )
    )

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <main className="app-page relative flex flex-col overflow-hidden">
      {/* Ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[460px]"
        style={{
          background:
            "radial-gradient(60% 80% at 50% 0%, rgba(255,92,24,0.10) 0%, rgba(255,92,24,0.04) 40%, transparent 75%)",
        }}
      />

      {/* Header */}
      <div className="glass-nav px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="subpage-back">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
            <HireovenLogo className="h-8 w-auto" priority />
          </div>
          <button
            onClick={() => router.push("/dashboard")}
            className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-800"
          >
            Skip for now
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center px-6 pb-16 pt-10 sm:pt-14">
        <div className="w-full max-w-3xl">
          {/* Hero kicker */}
          <div className="mb-8 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFD9C2] bg-[#FFF5EE] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FF5C18]">
              <Sparkles className="h-3 w-3" />
              Setup
            </span>
            <h1 className="mt-3 text-[1.75rem] font-bold leading-tight tracking-tight text-gray-900 sm:text-[2rem]">
              Let&apos;s get you ahead of the inbox.
            </h1>
            <p className="mt-2 text-sm text-gray-500 sm:text-[15px]">
              A quick three-step setup so we can surface the right roles the moment they post.
            </p>
          </div>

          {/* Stepper */}
          <Stepper current={step} />

          {/* Card */}
          <div className="surface-card-raised mt-7 rounded-2xl border border-gray-200/80 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04),0_30px_60px_-30px_rgba(15,23,42,0.20)] sm:p-9">
            {step === 1 && (
              <StepOne data={stepOne} onChange={setStepOne} onNext={next} />
            )}
            {step === 2 && (
              <StepTwo data={stepTwo} onChange={setStepTwo} onNext={next} onBack={back} />
            )}
            {step === 3 && (
              <StepThree
                data={stepThree}
                onChange={setStepThree}
                onFinish={handleFinish}
                onBack={back}
                saving={saving}
              />
            )}
          </div>

          <p className="mt-6 text-center text-xs text-gray-400">
            You can change any of this later in settings.
          </p>
        </div>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-2 sm:gap-3">
      {STEP_META.map((meta, i) => {
        const stepNum = i + 1
        const isComplete = stepNum < current
        const isActive = stepNum === current
        const Icon = meta.icon
        return (
          <div key={meta.title} className="flex items-center gap-2 sm:gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-semibold transition-all duration-300 ${
                  isComplete
                    ? "border-[#FF5C18] bg-[#FF5C18] text-white shadow-[0_4px_14px_-4px_rgba(255,92,24,0.55)]"
                    : isActive
                    ? "border-[#FF5C18] bg-white text-[#FF5C18] shadow-[0_4px_14px_-4px_rgba(255,92,24,0.4)]"
                    : "border-gray-200 bg-white text-gray-400"
                }`}
              >
                {isComplete ? (
                  <Check className="h-4 w-4" strokeWidth={3} />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <span
                className={`mt-1.5 hidden text-[11px] font-semibold tracking-wide transition-colors sm:block ${
                  isActive
                    ? "text-gray-900"
                    : isComplete
                    ? "text-[#FF5C18]"
                    : "text-gray-400"
                }`}
              >
                {meta.title}
              </span>
            </div>
            {i < STEP_META.length - 1 && (
              <div className="relative -mt-5 h-[2px] w-12 overflow-hidden rounded-full bg-gray-200 sm:w-20">
                <div
                  className="absolute inset-y-0 left-0 bg-[#FF5C18] transition-all duration-500 ease-out"
                  style={{ width: stepNum < current ? "100%" : "0%" }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1 - Job search preferences
// ---------------------------------------------------------------------------

function StepOne({
  data,
  onChange,
  onNext,
}: {
  data: StepOneData
  onChange: (d: StepOneData) => void
  onNext: () => void
}) {
  const roleInputRef = useRef<HTMLInputElement>(null)
  const locationInputRef = useRef<HTMLInputElement>(null)
  const [roleInput, setRoleInput] = useState("")
  const [locationInput, setLocationInput] = useState("")

  function addTag(
    field: "roles" | "locations",
    value: string,
    setter: (v: string) => void
  ) {
    const trimmed = value.trim()
    if (!trimmed) return
    if (!data[field].includes(trimmed)) {
      onChange({ ...data, [field]: [...data[field], trimmed] })
    }
    setter("")
  }

  function removeTag(field: "roles" | "locations", value: string) {
    onChange({ ...data, [field]: data[field].filter((v) => v !== value) })
  }

  function handleKeyDown(
    e: KeyboardEvent<HTMLInputElement>,
    field: "roles" | "locations",
    value: string,
    setter: (v: string) => void
  ) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addTag(field, value, setter)
    }
  }

  function toggleSeniority(value: SeniorityLevel) {
    const next = data.seniority.includes(value)
      ? data.seniority.filter((s) => s !== value)
      : [...data.seniority, value]
    onChange({ ...data, seniority: next })
  }

  const canContinue = data.roles.length > 0

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <SectionHeader
        title="Tell us about your job search"
        description="We'll use this to surface the right roles the moment they post."
      />

      <div className="space-y-7">
        {/* Roles */}
        <Field
          label="What roles are you looking for?"
          required
          hint="Add a few — be specific. Press Enter or comma to add."
        >
          {data.roles.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {data.roles.map((r) => (
                <Tag key={r} label={r} onRemove={() => removeTag("roles", r)} />
              ))}
            </div>
          )}
          <input
            ref={roleInputRef}
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "roles", roleInput, setRoleInput)}
            onBlur={() => addTag("roles", roleInput, setRoleInput)}
            placeholder='e.g. "Software Engineer"'
            className={inputClass}
          />
        </Field>

        {/* Locations */}
        <Field label="Preferred locations" hint="Add cities, regions, or leave blank for anywhere.">
          {data.locations.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-2">
              {data.locations.map((l) => (
                <Tag key={l} label={l} onRemove={() => removeTag("locations", l)} />
              ))}
            </div>
          )}
          <input
            ref={locationInputRef}
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "locations", locationInput, setLocationInput)}
            onBlur={() => addTag("locations", locationInput, setLocationInput)}
            disabled={data.remoteOnly}
            placeholder={data.remoteOnly ? "Remote selected" : 'e.g. "New York"'}
            className={`${inputClass} disabled:bg-gray-50 disabled:text-gray-400`}
          />
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={data.remoteOnly}
              onChange={(v) => onChange({ ...data, remoteOnly: v, locations: v ? [] : data.locations })}
            />
            <span className="text-sm text-gray-600">Remote only</span>
          </label>
        </Field>

        {/* Seniority */}
        <Field label="Seniority level" hint="Pick one or more.">
          <div className="flex flex-wrap gap-2">
            {SENIORITY_OPTIONS.map((opt) => {
              const selected = data.seniority.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleSeniority(opt.value)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                    selected
                      ? "border-[#FF5C18] bg-[#FF5C18] text-white shadow-[0_4px_12px_-4px_rgba(255,92,24,0.55)]"
                      : "border-gray-200 bg-white text-gray-600 hover:border-[#FFB78A] hover:bg-[#FFF7F2] hover:text-[#FF5C18]"
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </Field>
      </div>

      <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <PrimaryButton onClick={onNext} disabled={!canContinue} className="sm:min-w-[180px]">
          Continue
        </PrimaryButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 - International candidate status
// ---------------------------------------------------------------------------

function StepTwo({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: StepTwoData
  onChange: (d: StepTwoData) => void
  onNext: () => void
  onBack: () => void
}) {
  const showOptDate =
    data.isInternational &&
    (data.visaStatus === "opt" || data.visaStatus === "stem_opt")

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <SectionHeader
        title="Are you an international candidate?"
        description="We'll filter jobs by sponsorship availability so you only see roles you can actually apply for."
      />

      {/* Yes / No toggle */}
      <div className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          {
            value: true,
            label: "Yes, I need visa info",
            sub: "I'm on OPT, H-1B, or similar",
            emoji: "🌍",
          },
          {
            value: false,
            label: "No, I'm authorized",
            sub: "Citizen, green card, or other",
            emoji: "🇺🇸",
          },
        ].map((opt) => {
          const active = data.isInternational === opt.value
          return (
            <button
              key={String(opt.value)}
              type="button"
              onClick={() =>
                onChange({
                  ...data,
                  isInternational: opt.value,
                  visaStatus: opt.value ? data.visaStatus : "",
                  needsSponsorship: opt.value ? data.needsSponsorship : false,
                })
              }
              className={`group relative flex flex-col items-start gap-2 overflow-hidden rounded-xl border-2 p-5 text-left transition-all ${
                active
                  ? "border-[#FF5C18] bg-[#FFF7F2] shadow-[0_8px_24px_-12px_rgba(255,92,24,0.35)]"
                  : "border-gray-200 bg-white hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-[0_8px_24px_-16px_rgba(15,23,42,0.18)]"
              }`}
            >
              {active && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5C18] text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
              <span className="text-2xl">{opt.emoji}</span>
              <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
              <span className="text-xs text-gray-500">{opt.sub}</span>
            </button>
          )
        })}
      </div>

      {/* International sub-fields */}
      {data.isInternational && (
        <div className="animate-in fade-in slide-in-from-top-1 space-y-5 rounded-xl border border-[#FFE4D2] bg-gradient-to-b from-[#FFFBF8] to-white p-5 duration-300">
          <Field label="Current visa status">
            <select
              value={data.visaStatus}
              onChange={(e) =>
                onChange({ ...data, visaStatus: e.target.value as VisaStatus })
              }
              className={inputClass}
            >
              <option value="">Select visa status…</option>
              {VISA_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          {showOptDate && (
            <Field
              label="OPT end date"
              hint="We'll surface sponsorship-ready roles before your OPT expires."
            >
              <input
                type="date"
                value={data.optEndDate}
                onChange={(e) => onChange({ ...data, optEndDate: e.target.value })}
                className={inputClass}
              />
            </Field>
          )}

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-transparent p-2 -mx-2 transition-colors hover:border-[#FFE4D2] hover:bg-white">
            <Checkbox
              checked={data.needsSponsorship}
              onChange={(v) => onChange({ ...data, needsSponsorship: v })}
            />
            <div>
              <span className="text-sm font-medium text-gray-800">
                I need H-1B sponsorship
              </span>
              <p className="mt-0.5 text-xs text-gray-500">
                We&apos;ll only show roles at companies that have sponsored in the past.
              </p>
            </div>
          </label>
        </div>
      )}

      <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <SecondaryButton onClick={onBack}>Back</SecondaryButton>
        <PrimaryButton onClick={onNext} className="sm:min-w-[180px]">
          Continue
        </PrimaryButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 - Company watchlist
// ---------------------------------------------------------------------------

function StepThree({
  data,
  onChange,
  onFinish,
  onBack,
  saving,
}: {
  data: StepThreeData
  onChange: (d: StepThreeData) => void
  onFinish: () => void
  onBack: () => void
  saving: boolean
}) {
  const [query, setQuery] = useState("")
  const [companies, setCompanies] = useState<Company[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(true)

  useEffect(() => {
    async function fetchCompanies() {
      const res = await fetch("/api/companies?limit=500&sort=name")
      if (res.ok) {
        const { companies: rows } = (await res.json()) as { companies: Company[] }
        setCompanies(rows ?? [])
      }
      setLoadingCompanies(false)
    }
    void fetchCompanies()
  }, [])

  const filtered = query.trim()
    ? companies.filter((c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) ||
        (c.industry ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : companies

  function toggle(id: string) {
    const selected = data.selectedCompanyIds
    if (selected.includes(id)) {
      onChange({ selectedCompanyIds: selected.filter((s) => s !== id) })
    } else if (selected.length < MAX_COMPANIES) {
      onChange({ selectedCompanyIds: [...selected, id] })
    }
  }

  const selectedCount = data.selectedCompanyIds.length
  const pct = Math.min(100, (selectedCount / MAX_COMPANIES) * 100)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <SectionHeader
        title="Pick your dream companies"
        description="We'll notify you the moment they post a matching role."
      />

      {/* Selection meter */}
      <div className="mb-5 flex items-center justify-between gap-4">
        <p className="text-xs font-medium text-gray-500">
          <span className="text-gray-900">{selectedCount}</span>
          <span className="text-gray-400"> / {MAX_COMPANIES} selected</span>
        </p>
        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-[#FF5C18] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies by name or industry…"
          className={`${inputClass} pl-10`}
        />
      </div>

      {/* Company grid */}
      {loadingCompanies ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-[68px] animate-pulse rounded-xl border border-gray-100 bg-gray-50"
            />
          ))}
        </div>
      ) : (
        <div className="grid max-h-[440px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {filtered.map((company) => {
            const selected = data.selectedCompanyIds.includes(company.id)
            const atLimit = selectedCount >= MAX_COMPANIES && !selected
            return (
              <button
                key={company.id}
                type="button"
                onClick={() => toggle(company.id)}
                disabled={atLimit}
                className={`group flex items-center gap-3 rounded-xl border-2 p-3.5 text-left transition-all ${
                  selected
                    ? "border-[#FF5C18] bg-[#FFF7F2] shadow-[0_6px_18px_-10px_rgba(255,92,24,0.35)]"
                    : atLimit
                    ? "cursor-not-allowed border-gray-100 bg-gray-50 opacity-40"
                    : "border-gray-200 bg-white hover:-translate-y-0.5 hover:border-[#FFB78A] hover:shadow-[0_6px_18px_-12px_rgba(15,23,42,0.18)]"
                }`}
              >
                <CompanyLogo
                  companyName={company.name}
                  domain={company.domain}
                  logoUrl={company.logo_url}
                  className="h-9 w-9 shrink-0 bg-white ring-1 ring-gray-100"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {company.name}
                    </p>
                    {company.sponsors_h1b && (
                      <span className="shrink-0 rounded-full bg-[#FFF1E8] px-1.5 py-0.5 text-[10px] font-semibold text-[#FF5C18]">
                        H-1B
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-400">
                    {company.industry ?? "Technology"}
                  </p>
                </div>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all ${
                    selected
                      ? "bg-[#FF5C18] text-white"
                      : "border border-gray-200 bg-white text-transparent group-hover:border-[#FFB78A]"
                  }`}
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-gray-200 bg-gray-50/50 py-12 text-center text-sm text-gray-400">
              No companies match &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <SecondaryButton onClick={onBack} disabled={saving}>
          Back
        </SecondaryButton>
        <PrimaryButton onClick={onFinish} disabled={saving} className="sm:min-w-[260px]">
          {saving ? (
            <><Spinner /> Saving…</>
          ) : selectedCount > 0 ? (
            `Start watching ${selectedCount} ${selectedCount === 1 ? "company" : "companies"}`
          ) : (
            "Go to dashboard"
          )}
        </PrimaryButton>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared micro-components
// ---------------------------------------------------------------------------

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-[#FF5C18] focus:outline-none focus:ring-4 focus:ring-[#FF5C18]/15"

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-7">
      <h2 className="text-[1.4rem] font-bold tracking-tight text-gray-900 sm:text-[1.55rem]">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-gray-500">{description}</p>
    </div>
  )
}

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-gray-800">
        {label}
        {required && <span className="ml-1 text-[#FF5C18]">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-[#FF5C18] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(255,92,24,0.55)] transition-all hover:-translate-y-0.5 hover:bg-[#E14F0E] hover:shadow-[0_12px_24px_-10px_rgba(255,92,24,0.65)] disabled:translate-y-0 disabled:opacity-40 disabled:shadow-none ${className}`}
    >
      {children}
    </button>
  )
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-6 py-3.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
    >
      {children}
    </button>
  )
}

function Tag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#FFD9C2] bg-[#FFF1E8] px-3 py-1.5 text-xs font-medium text-[#FF5C18]">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 transition-colors hover:bg-[#FF5C18]/15"
        aria-label={`Remove ${label}`}
      >
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeWidth={2} d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </span>
  )
}

function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-all ${
        checked
          ? "border-[#FF5C18] bg-[#FF5C18] shadow-[0_2px_8px_-2px_rgba(255,92,24,0.55)]"
          : "border-gray-300 bg-white hover:border-[#FFB78A]"
      }`}
      role="checkbox"
      aria-checked={checked}
    >
      {checked && (
        <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M2 6l3 3 5-5" />
        </svg>
      )}
    </button>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}
