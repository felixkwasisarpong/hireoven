"use client"

import { KeyboardEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { createClient } from "@/lib/supabase/client"
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

const TOTAL_STEPS = 3
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

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push("/login")
      return
    }

    // Update profile
    await (supabase.from("profiles") as any).update({
      desired_roles: stepOne.roles,
      desired_locations: stepOne.remoteOnly ? ["Remote"] : stepOne.locations,
      desired_seniority: stepOne.seniority,
      remote_only: stepOne.remoteOnly,
      is_international: stepTwo.isInternational,
      visa_status: stepTwo.visaStatus || null,
      opt_end_date: stepTwo.optEndDate || null,
      needs_sponsorship: stepTwo.needsSponsorship,
    }).eq("id", user.id)

    // Insert watchlist entries
    if (stepThree.selectedCompanyIds.length > 0) {
      await (supabase.from("watchlist") as any).insert(
        stepThree.selectedCompanyIds.map((company_id) => ({
          user_id: user.id,
          company_id,
        }))
      )
    }

    router.push("/dashboard")
    router.refresh()
  }

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <HireovenLogo className="h-8 w-auto" priority />
          <button
            onClick={() => router.push("/dashboard")}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip for now
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-xl mx-auto px-6 py-3">
          <div className="flex items-center gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className="h-1.5 flex-1 rounded-full transition-colors duration-300"
                style={{ backgroundColor: i < step ? "#0369A1" : "#E5E7EB" }}
              />
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">Step {step} of {TOTAL_STEPS}</p>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col items-center px-6 py-10">
        <div className="w-full max-w-xl">
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
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Step 1 — Job search preferences
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
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">
        Tell us about your job search
      </h2>
      <p className="text-sm text-gray-500 mb-8">
        We&apos;ll use this to surface the right roles the moment they post.
      </p>

      <div className="space-y-6">
        {/* Roles */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            What roles are you looking for?
            <span className="text-[#0369A1] ml-1">*</span>
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {data.roles.map((r) => (
              <Tag key={r} label={r} onRemove={() => removeTag("roles", r)} />
            ))}
          </div>
          <input
            ref={roleInputRef}
            value={roleInput}
            onChange={(e) => setRoleInput(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "roles", roleInput, setRoleInput)}
            onBlur={() => addTag("roles", roleInput, setRoleInput)}
            placeholder='e.g. "Software Engineer" — press Enter to add'
            className="w-full px-4 py-3 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent"
          />
        </div>

        {/* Locations */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Preferred locations
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {data.locations.map((l) => (
              <Tag key={l} label={l} onRemove={() => removeTag("locations", l)} />
            ))}
          </div>
          <input
            ref={locationInputRef}
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            onKeyDown={(e) => handleKeyDown(e, "locations", locationInput, setLocationInput)}
            onBlur={() => addTag("locations", locationInput, setLocationInput)}
            disabled={data.remoteOnly}
            placeholder={data.remoteOnly ? "Remote selected" : 'e.g. "New York" — press Enter to add'}
            className="w-full px-4 py-3 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent disabled:bg-gray-50 disabled:text-gray-400"
          />
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <Checkbox
              checked={data.remoteOnly}
              onChange={(v) => onChange({ ...data, remoteOnly: v, locations: v ? [] : data.locations })}
            />
            <span className="text-sm text-gray-600">Remote only</span>
          </label>
        </div>

        {/* Seniority */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">
            Seniority level
          </label>
          <div className="flex flex-wrap gap-2">
            {SENIORITY_OPTIONS.map((opt) => {
              const selected = data.seniority.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleSeniority(opt.value)}
                  className={`px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
                    selected
                      ? "bg-[#0369A1] border-[#0369A1] text-white"
                      : "bg-white border-gray-200 text-gray-600 hover:border-[#0369A1] hover:text-[#0369A1]"
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onNext}
        disabled={!canContinue}
        className="mt-10 w-full py-3.5 bg-[#0369A1] hover:bg-[#075985] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40"
      >
        Continue
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 2 — International candidate status
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
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">
        Are you an international candidate?
      </h2>
      <p className="text-sm text-gray-500 mb-8">
        We&apos;ll filter jobs by sponsorship availability so you only see roles you can actually apply for.
      </p>

      {/* Yes / No toggle — prominent */}
      <div className="grid grid-cols-2 gap-3 mb-8">
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
        ].map((opt) => (
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
            className={`flex flex-col items-start gap-1.5 p-5 rounded-xl border-2 text-left transition-all ${
              data.isInternational === opt.value
                ? "border-[#0369A1] bg-[#0369A1]/5"
                : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <span className="text-2xl">{opt.emoji}</span>
            <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
            <span className="text-xs text-gray-500">{opt.sub}</span>
          </button>
        ))}
      </div>

      {/* International sub-fields */}
      {data.isInternational && (
        <div className="space-y-5 bg-white border border-gray-100 rounded-xl p-5">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Current visa status
            </label>
            <select
              value={data.visaStatus}
              onChange={(e) =>
                onChange({ ...data, visaStatus: e.target.value as VisaStatus })
              }
              className="w-full px-4 py-3 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent bg-white"
            >
              <option value="">Select visa status…</option>
              {VISA_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {showOptDate && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                OPT end date
              </label>
              <input
                type="date"
                value={data.optEndDate}
                onChange={(e) => onChange({ ...data, optEndDate: e.target.value })}
                className="w-full px-4 py-3 rounded-lg border border-gray-200 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                We&apos;ll surface sponsorship-ready roles before your OPT expires.
              </p>
            </div>
          )}

          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={data.needsSponsorship}
              onChange={(v) => onChange({ ...data, needsSponsorship: v })}
            />
            <div>
              <span className="text-sm font-medium text-gray-700">
                I need H-1B sponsorship
              </span>
              <p className="text-xs text-gray-400 mt-0.5">
                We&apos;ll only show roles at companies that have sponsored in the past.
              </p>
            </div>
          </label>
        </div>
      )}

      <div className="flex gap-3 mt-10">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-3.5 border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          className="flex-[2] py-3.5 bg-[#0369A1] hover:bg-[#075985] text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Continue
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 3 — Company watchlist
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
      const supabase = createClient()
      const { data: rows } = await supabase
        .from("companies")
        .select("*")
        .eq("is_active", true)
        .order("name")
      setCompanies(rows ?? [])
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

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-1">
        Pick your dream companies
      </h2>
      <p className="text-sm text-gray-500 mb-1">
        We&apos;ll notify you the moment they post a matching role.
      </p>
      <p className="text-xs text-gray-400 mb-6">
        Select up to {MAX_COMPANIES}
        {selectedCount > 0 && (
          <span className="text-[#0369A1] font-medium"> — {selectedCount} selected</span>
        )}
      </p>

      {/* Search */}
      <div className="relative mb-5">
        <svg
          className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M16.65 10A6.65 6.65 0 111 10a6.65 6.65 0 0115.3 0z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search companies…"
          className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0369A1] focus:border-transparent"
        />
      </div>

      {/* Company grid */}
      {loadingCompanies ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-[420px] overflow-y-auto pr-1">
          {filtered.map((company) => {
            const selected = data.selectedCompanyIds.includes(company.id)
            const atLimit = selectedCount >= MAX_COMPANIES && !selected
            return (
              <button
                key={company.id}
                type="button"
                onClick={() => toggle(company.id)}
                disabled={atLimit}
                className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                  selected
                    ? "border-[#0369A1] bg-[#0369A1]/5"
                    : atLimit
                    ? "border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                {/* Logo / fallback */}
                {company.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={company.logo_url}
                    alt={company.name}
                    className="w-9 h-9 rounded-lg object-contain flex-shrink-0 bg-gray-50"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-gray-400">
                      {company.name[0]}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {company.name}
                    </p>
                    {company.sponsors_h1b && (
                      <span className="shrink-0 text-[10px] font-semibold bg-[#0369A1]/10 text-[#0369A1] px-1.5 py-0.5 rounded-full">
                        H-1B
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 truncate mt-0.5">
                    {company.industry ?? "Technology"}
                  </p>
                </div>
                {selected && (
                  <svg className="h-4 w-4 text-[#0369A1] shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="col-span-2 py-10 text-center text-sm text-gray-400">
              No companies match &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3 mt-8">
        <button
          type="button"
          onClick={onBack}
          disabled={saving}
          className="flex-1 py-3.5 border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onFinish}
          disabled={saving}
          className="flex-[2] flex items-center justify-center gap-2 py-3.5 bg-[#0369A1] hover:bg-[#075985] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60"
        >
          {saving ? (
            <><Spinner /> Saving…</>
          ) : selectedCount > 0 ? (
            `Start watching ${selectedCount} ${selectedCount === 1 ? "company" : "companies"}`
          ) : (
            "Go to dashboard"
          )}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared micro-components
// ---------------------------------------------------------------------------

function Tag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-[#0369A1]/10 text-[#0369A1] text-xs font-medium px-3 py-1.5 rounded-full">
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="hover:text-[#075985] transition-colors"
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
      className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
        checked ? "bg-[#0369A1] border-[#0369A1]" : "border-gray-300 bg-white"
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
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}
