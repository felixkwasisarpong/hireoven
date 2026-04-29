"use client"

import { useCallback, useEffect, useState } from "react"
import {
  BookOpen,
  Briefcase,
  ExternalLink,
  Globe,
  Loader2,
  Lock,
  Save,
  Sparkles,
  User,
  CheckCircle2,
  Shield,
} from "lucide-react"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useAuth } from "@/lib/hooks/useAuth"
import { cn } from "@/lib/utils"
import type {
  AutofillProfile,
  CustomAnswer,
  PreferredWorkType,
  WorkAuthorization,
} from "@/types"

// ── Section nav config ────────────────────────────────────────────────────────

const SECTION_NAV = [
  { id: "personal",   label: "Personal",       Icon: User },
  { id: "links",      label: "Links",           Icon: Globe },
  { id: "work-auth",  label: "Work auth",       Icon: Lock },
  { id: "experience", label: "Experience",      Icon: Briefcase },
  { id: "education",  label: "Education",       Icon: BookOpen },
  { id: "qa",         label: "Pre-written Q&A", Icon: Sparkles },
  { id: "diversity",  label: "EEO & diversity", Icon: Shield },
] as const

// ── Circular progress ring ────────────────────────────────────────────────────

function ProgressRing({ pct }: { pct: number }) {
  const r = 30
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ
  const color = pct >= 80 ? "#10b981" : pct >= 50 ? "#f59e0b" : "#FF5C18"
  return (
    <svg width="80" height="80" viewBox="0 0 80 80" className="-rotate-90">
      <circle cx="40" cy="40" r={r} fill="none" stroke="#f1f5f9" strokeWidth="5" />
      <circle
        cx="40" cy="40" r={r}
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  id,
  icon,
  title,
  subtitle,
  index,
  children,
}: {
  id: string
  icon: React.ReactNode
  title: string
  subtitle?: string
  index: number
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className="scroll-mt-4 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.05),0_8px_24px_-8px_rgba(0,0,0,0.08)]"
    >
      {/* Header band */}
      <div className="relative flex items-center gap-4 border-b border-orange-100/60 bg-gradient-to-r from-[#FFF3EB] via-[#FFF7F2]/70 to-transparent px-6 py-5">
        {/* Left accent bar */}
        <span className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-[#FF5C18] to-[#FFAB80] rounded-r-full" />

        {/* Icon */}
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#FFD5B8]/70 bg-white text-[#FF5C18] shadow-sm">
          {icon}
        </span>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-900 leading-tight">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
        </div>

        {/* Decorative section number */}
        <span className="select-none text-3xl font-black leading-none text-slate-100 tabular-nums">
          {String(index).padStart(2, "0")}
        </span>
      </div>

      <div className="space-y-5 px-6 py-6">{children}</div>
    </section>
  )
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-gray-400">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/12 focus:shadow-[0_0_0_3px_rgba(255,92,24,0.08)]"

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={inputCls}
    />
  )
}

function PillSelect<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T | null
  onChange: (v: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-xl px-4 py-2 text-sm font-medium transition-all",
            value === opt.value
              ? "bg-[#FF5C18] text-white shadow-sm shadow-[#FF5C18]/30"
              : "border border-slate-200 bg-white text-gray-600 hover:border-[#FF5C18]/40 hover:text-[#FF5C18]"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultSponsorshipStatement(visaStatus: string, optEndDate?: string | null): string {
  const dateStr = optEndDate
    ? new Date(optEndDate).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "the current period"
  if (visaStatus === "opt")
    return `I am currently authorized to work in the US on OPT, valid until ${dateStr}. I will require H1B sponsorship and am actively seeking employers who can sponsor. I am happy to discuss timing and the process.`
  if (visaStatus === "stem_opt")
    return `I am currently on STEM OPT, valid until ${dateStr}, giving me up to 3 years of work authorization. I will eventually require H1B sponsorship and look forward to discussing this with you.`
  if (visaStatus === "h1b")
    return `I currently hold an H1B visa and would require transfer sponsorship. I am happy to facilitate this process and can provide all necessary documentation.`
  return `I will require visa sponsorship to work in the US. I am happy to discuss my work authorization status and the sponsorship process at any stage.`
}

// ── Options ───────────────────────────────────────────────────────────────────

const WORK_AUTH_OPTIONS: Array<{ value: WorkAuthorization; label: string }> = [
  { value: "us_citizen",          label: "US Citizen or Permanent Resident" },
  { value: "green_card",          label: "Green Card holder" },
  { value: "h1b",                 label: "H1B Visa" },
  { value: "opt",                 label: "Currently on OPT" },
  { value: "stem_opt",            label: "Currently on STEM OPT" },
  { value: "tn_visa",             label: "TN Visa" },
  { value: "other",               label: "Other work visa" },
  { value: "require_sponsorship", label: "Require sponsorship" },
]

const WORK_TYPE_OPTIONS: Array<{ value: PreferredWorkType; label: string }> = [
  { value: "remote",   label: "Remote" },
  { value: "hybrid",   label: "Hybrid" },
  { value: "onsite",   label: "On-site" },
  { value: "flexible", label: "Flexible" },
]

const DEGREE_OPTIONS = [
  "High School / GED", "Associate's", "Bachelor's", "Master's",
  "MBA", "PhD", "JD", "MD", "Other",
]

const DEFAULT_QA: CustomAnswer[] = [
  { question_pattern: "why.*company|why.*want.*work|what.*draws.*you", answer: "" },
  { question_pattern: "tell.*yourself|about.*yourself|background",     answer: "" },
  { question_pattern: "salary|compensation|pay.*expect",               answer: "" },
  { question_pattern: "greatest.*achievement|proudest.*accomplishment", answer: "" },
  { question_pattern: "overtime|travel.*role|willing.*travel",         answer: "" },
]

const QA_LABELS: Record<string, string> = {
  "why.*company|why.*want.*work|what.*draws.*you":   "Why do you want to work here?",
  "tell.*yourself|about.*yourself|background":        "Tell me about yourself",
  "salary|compensation|pay.*expect":                  "What are your salary expectations?",
  "greatest.*achievement|proudest.*accomplishment":   "Greatest professional achievement",
  "overtime|travel.*role|willing.*travel":            "Willing to work overtime / travel?",
}

const GENDER_OPTIONS    = ["Male", "Female", "Non-binary / gender non-conforming", "Prefer not to say"]
const ETHNICITY_OPTIONS = [
  "Hispanic or Latino", "White (Not Hispanic or Latino)", "Black or African American",
  "Asian", "American Indian or Alaska Native", "Native Hawaiian or Other Pacific Islander",
  "Two or More Races", "Prefer not to answer",
]
const VETERAN_OPTIONS = [
  "I am not a protected veteran",
  "I identify as one or more classifications of a protected veteran",
  "I don't wish to answer",
]
const DISABILITY_OPTIONS = [
  "No, I don't have a disability",
  "Yes, I have a disability",
  "I don't wish to answer",
]

// ── Form state ────────────────────────────────────────────────────────────────

type FormState = Omit<AutofillProfile, "id" | "user_id" | "created_at" | "updated_at">

const EMPTY_FORM: FormState = {
  first_name: null, last_name: null, email: null, phone: null,
  address_line1: null, address_line2: null, city: null, state: null,
  zip_code: null, country: "United States",
  linkedin_url: null, github_url: null, portfolio_url: null, website_url: null,
  work_authorization: null, requires_sponsorship: false, authorized_to_work: true,
  sponsorship_statement: null, years_of_experience: null,
  salary_expectation_min: null, salary_expectation_max: null,
  earliest_start_date: null, willing_to_relocate: false, preferred_work_type: null,
  custom_answers: DEFAULT_QA,
  highest_degree: null, field_of_study: null, university: null,
  graduation_year: null, gpa: null,
  gender: null, ethnicity: null, veteran_status: null, disability_status: null,
  auto_fill_diversity: false,
}

function calcLocalCompletion(form: FormState): number {
  const required: Array<keyof FormState> = [
    "first_name", "last_name", "email", "phone",
    "linkedin_url", "work_authorization", "years_of_experience",
    "salary_expectation_min", "highest_degree", "university",
  ]
  const optional: Array<keyof FormState> = [
    "github_url", "portfolio_url", "city", "state",
    "earliest_start_date", "gpa",
  ]
  const req = required.filter((k) => { const v = form[k]; return v !== null && v !== undefined && v !== "" }).length
  const opt = optional.filter((k) => { const v = form[k]; return v !== null && v !== undefined && v !== "" }).length
  const customBonus = (form.custom_answers ?? []).some((qa) => qa.answer.trim()) ? 5 : 0
  const maxScore = required.length * 10 + optional.length * 5 + 5
  return Math.round(((req * 10 + opt * 5 + customBonus) / maxScore) * 100)
}

function salaryExpectationAnswer(min: number | null, max: number | null) {
  if (min && max)
    return `I am targeting a base salary in the $${min.toLocaleString()} to $${max.toLocaleString()} range, depending on scope, level, and total compensation.`
  if (min)
    return `I am targeting a base salary starting around $${min.toLocaleString()}, depending on scope and total compensation.`
  return ""
}

function initials(name: string) {
  return name.trim().split(/\s+/).map((n) => n[0]).slice(0, 2).join("").toUpperCase()
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AutofillPage() {
  const { profile: authProfile } = useAuth()
  const { primaryResume } = useResumeContext()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle")
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isImprovingStatement, setIsImprovingStatement] = useState(false)
  const [showAddress, setShowAddress] = useState(false)

  const completion = calcLocalCompletion(form)
  const completionTextColor =
    completion >= 80 ? "text-emerald-600" : completion >= 50 ? "text-amber-500" : "text-[#FF5C18]"

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }
  const str = (v: string | null | undefined) => v ?? ""

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/autofill/profile")
      if (!res.ok) return
      const { profile: autofillProfile } = await res.json() as { profile: AutofillProfile | null }

      if (autofillProfile) {
        setProfileId(autofillProfile.id)
        const { id, user_id, created_at, updated_at, ...rest } = autofillProfile
        setForm({ ...EMPTY_FORM, ...rest })
      } else if (primaryResume?.parse_status === "complete") {
        const r = primaryResume
        const nameParts = (r.full_name ?? "").trim().split(/\s+/)
        const [firstName, ...lastParts] = nameParts
        setForm((prev) => ({
          ...prev,
          first_name: firstName ?? null,
          last_name: lastParts.join(" ") || null,
          email: r.email ?? null,
          phone: r.phone ?? null,
          linkedin_url: r.linkedin_url ?? null,
          portfolio_url: r.portfolio_url ?? null,
          years_of_experience: r.years_of_experience ?? null,
          university: (r.education ?? [])[0]?.institution ?? null,
          highest_degree: (r.education ?? [])[0]?.degree ?? null,
          field_of_study: (r.education ?? [])[0]?.field ?? null,
          custom_answers: DEFAULT_QA.map((qa) =>
            qa.question_pattern.includes("yourself")
              ? { ...qa, answer: r.summary ?? "" }
              : qa
          ),
        }))
      } else if (authProfile) {
        const nameParts = (authProfile.full_name ?? "").trim().split(/\s+/)
        const [firstName, ...lastParts] = nameParts
        setForm((prev) => ({
          ...prev,
          first_name: prev.first_name ?? firstName ?? null,
          last_name: prev.last_name ?? (lastParts.join(" ") || null),
          email: prev.email ?? authProfile.email ?? null,
        }))
      }
    }
    void load()
  }, [authProfile, primaryResume])

  useEffect(() => {
    const needsSponsorship = ["opt", "stem_opt", "h1b", "require_sponsorship"].includes(
      form.work_authorization ?? ""
    )
    if (needsSponsorship && !form.sponsorship_statement) {
      set("sponsorship_statement", defaultSponsorshipStatement(
        form.work_authorization ?? "",
        authProfile?.opt_end_date ?? null
      ))
    }
    set("requires_sponsorship", needsSponsorship)
    set("authorized_to_work", form.work_authorization !== "require_sponsorship")
  }, [authProfile?.opt_end_date, form.work_authorization, form.sponsorship_statement]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const salaryAnswer = salaryExpectationAnswer(form.salary_expectation_min, form.salary_expectation_max)
    if (!salaryAnswer) return
    setForm((prev) => ({
      ...prev,
      custom_answers: (prev.custom_answers ?? []).map((qa) =>
        qa.question_pattern.includes("salary") ? { ...qa, answer: qa.answer || salaryAnswer } : qa
      ),
    }))
  }, [form.salary_expectation_min, form.salary_expectation_max])

  async function improveStatement() {
    if (!form.sponsorship_statement) return
    setIsImprovingStatement(true)
    try {
      const res = await fetch("/api/autofill/improve-statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statement: form.sponsorship_statement, visaStatus: form.work_authorization }),
      })
      const data = await res.json() as { statement?: string }
      if (data.statement) set("sponsorship_statement", data.statement)
    } finally {
      setIsImprovingStatement(false)
    }
  }

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    setSaveStatus("idle")
    setSaveError(null)
    try {
      const res = await fetch("/api/autofill/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json() as { profile?: AutofillProfile; error?: string }
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      if (data.profile && !profileId) setProfileId(data.profile.id)
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus("idle"), 3000)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Save failed")
      setSaveStatus("error")
    } finally {
      setIsSaving(false)
    }
  }, [profileId, form])

  const needsSponsorship = ["opt", "stem_opt", "h1b", "require_sponsorship"].includes(
    form.work_authorization ?? ""
  )

  return (
    <main className="relative app-page">
      <div className="app-shell max-w-[1280px]">
        <DashboardPageHeader
          kicker="Autofill profile"
          title="Fill it once, reuse it everywhere"
          description="Fill this out once. We'll use it to fill job applications across Greenhouse, Lever, Workday, Ashby, and more."
          backHref="/dashboard"
          backLabel="Back to dashboard"
        />

        <div className="mt-6 flex items-start gap-7">

          {/* ── Sidebar ─────────────────────────────────────────────────────── */}
          <aside className="hidden lg:flex w-56 xl:w-60 shrink-0 sticky top-6 self-start flex-col gap-3">

            {/* User + progress card */}
            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.05),0_8px_24px_-8px_rgba(0,0,0,0.08)]">
              {/* User identity */}
              {authProfile?.full_name && (
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#FF5C18] to-[#FF9A60] text-xs font-bold text-white shadow-sm">
                    {initials(authProfile.full_name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800">{authProfile.full_name}</p>
                    {authProfile.email && (
                      <p className="truncate text-[11px] text-gray-400">{authProfile.email}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Donut progress */}
              <div className="flex flex-col items-center gap-2 py-5">
                <div className="relative">
                  <ProgressRing pct={completion} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={cn("text-xl font-bold tabular-nums leading-none", completionTextColor)}>
                      {completion}
                    </span>
                    <span className="mt-0.5 text-[10px] font-medium text-gray-400">%</span>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold text-gray-700">
                    {completion < 50 ? "Getting started" : completion < 80 ? "Almost there" : "Profile ready"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    {completion < 50
                      ? "Add your basics to get started"
                      : completion < 80
                      ? "A few more fields and you're set"
                      : "Ready to autofill most applications"}
                  </p>
                </div>
              </div>
            </div>

            {/* Section nav */}
            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white p-2 shadow-[0_1px_4px_rgba(0,0,0,0.05),0_8px_24px_-8px_rgba(0,0,0,0.08)]">
              {SECTION_NAV.map(({ id, label, Icon }) => (
                <a
                  key={id}
                  href={`#${id}`}
                  className="group relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-gray-500 transition-all hover:bg-[#FFF7F2] hover:text-[#FF5C18]"
                >
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-[#FF5C18] opacity-0 transition-opacity group-hover:opacity-100" />
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium">{label}</span>
                </a>
              ))}
            </div>

            {/* Save button */}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#FF5C18] to-[#FF7A3D] py-3.5 text-sm font-semibold text-white shadow-md shadow-[#FF5C18]/25 transition-all hover:shadow-lg hover:shadow-[#FF5C18]/30 hover:from-[#E14F0E] hover:to-[#FF6A30] disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? "Saving…" : "Save profile"}
            </button>

            {/* Save feedback */}
            {saveStatus === "saved" && (
              <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> Autofill profile saved
              </p>
            )}
            {saveStatus === "error" && (
              <p className="text-center text-xs font-medium text-red-500">
                {saveError ?? "Save failed — try again"}
              </p>
            )}
          </aside>

          {/* ── Main content ─────────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-5 pb-40 lg:pb-10">

            {/* 01 — Personal information */}
            <Section id="personal" icon={<User className="h-4 w-4" />} title="Personal information" index={1}>
              <div className="grid grid-cols-2 gap-4">
                <Field label="First name">
                  <Input value={str(form.first_name)} onChange={(v) => set("first_name", v || null)} placeholder="Jane" />
                </Field>
                <Field label="Last name">
                  <Input value={str(form.last_name)} onChange={(v) => set("last_name", v || null)} placeholder="Smith" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email">
                  <Input type="email" value={str(form.email)} onChange={(v) => set("email", v || null)} placeholder="jane@example.com" />
                </Field>
                <Field label="Phone">
                  <Input type="tel" value={str(form.phone)} onChange={(v) => set("phone", v || null)} placeholder="(555) 123-4567" />
                </Field>
              </div>

              <button
                type="button"
                onClick={() => setShowAddress((s) => !s)}
                className="text-xs font-semibold text-[#FF5C18] transition-colors hover:text-[#E14F0E]"
              >
                {showAddress ? "− Hide address" : "+ Add address (optional)"}
              </button>

              {showAddress && (
                <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-5">
                  <Field label="Address line 1">
                    <Input value={str(form.address_line1)} onChange={(v) => set("address_line1", v || null)} placeholder="123 Main St" />
                  </Field>
                  <Field label="Address line 2">
                    <Input value={str(form.address_line2)} onChange={(v) => set("address_line2", v || null)} placeholder="Apt 4B" />
                  </Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="City">
                      <Input value={str(form.city)} onChange={(v) => set("city", v || null)} placeholder="San Francisco" />
                    </Field>
                    <Field label="State">
                      <Input value={str(form.state)} onChange={(v) => set("state", v || null)} placeholder="CA" />
                    </Field>
                    <Field label="ZIP">
                      <Input value={str(form.zip_code)} onChange={(v) => set("zip_code", v || null)} placeholder="94105" />
                    </Field>
                  </div>
                  <Field label="Country">
                    <Input value={str(form.country)} onChange={(v) => set("country", v || "United States")} placeholder="United States" />
                  </Field>
                </div>
              )}
            </Section>

            {/* 02 — Professional links */}
            <Section
              id="links"
              icon={<Globe className="h-4 w-4" />}
              title="Professional links"
              subtitle="Used to fill LinkedIn, GitHub, and portfolio fields automatically"
              index={2}
            >
              <div className="space-y-4">
                {[
                  { key: "linkedin_url"  as const, label: "LinkedIn",      placeholder: "https://linkedin.com/in/janesmith" },
                  { key: "github_url"    as const, label: "GitHub",        placeholder: "https://github.com/janesmith" },
                  { key: "portfolio_url" as const, label: "Portfolio",     placeholder: "https://janesmith.dev" },
                  { key: "website_url"   as const, label: "Other website", placeholder: "https://blog.example.com" },
                ].map(({ key, label, placeholder }) => (
                  <Field key={key} label={label}>
                    <div className="flex gap-2">
                      <Input value={str(form[key])} onChange={(v) => set(key, v || null)} placeholder={placeholder} />
                      {form[key] && (
                        <a
                          href={str(form[key])}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-gray-500 transition hover:border-[#FF5C18]/40 hover:text-[#FF5C18] whitespace-nowrap"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">Test</span>
                        </a>
                      )}
                    </div>
                  </Field>
                ))}
              </div>
            </Section>

            {/* 03 — Work authorization */}
            <Section
              id="work-auth"
              icon={<Lock className="h-4 w-4" />}
              title="Work authorization"
              subtitle="Critical — affects every application"
              index={3}
            >
              <Field label="Authorization status">
                <select
                  value={form.work_authorization ?? ""}
                  onChange={(e) => set("work_authorization", (e.target.value as WorkAuthorization) || null)}
                  className={inputCls}
                >
                  <option value="">Select status…</option>
                  {WORK_AUTH_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </Field>

              {needsSponsorship && (
                <div className="space-y-4 rounded-2xl border border-[#FFD5B8] bg-gradient-to-br from-[#FFF7F2] to-[#FFF3EC] p-5">
                  <div>
                    <p className="text-sm font-semibold text-[#C2410C]">Sponsorship statement</p>
                    <p className="mt-0.5 text-xs text-[#EA580C]/80">
                      Edit this to sound like you — we&rsquo;ll use it when applications ask about visa sponsorship.
                    </p>
                  </div>
                  <textarea
                    value={str(form.sponsorship_statement)}
                    onChange={(e) => set("sponsorship_statement", e.target.value || null)}
                    rows={4}
                    className="w-full resize-none rounded-xl border border-[#FFD5B8]/80 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/12"
                    placeholder="I am currently authorized to work on OPT…"
                  />
                  <button
                    type="button"
                    onClick={() => void improveStatement()}
                    disabled={isImprovingStatement || !form.sponsorship_statement}
                    className="flex items-center gap-2 rounded-xl border border-[#FFD5B8] bg-white px-4 py-2 text-xs font-semibold text-[#FF5C18] transition hover:bg-[#FFF1E8] disabled:opacity-50"
                  >
                    {isImprovingStatement
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Sparkles className="h-3.5 w-3.5" />}
                    {isImprovingStatement ? "Improving…" : "Improve with AI"}
                  </button>
                </div>
              )}

              {!needsSponsorship && form.work_authorization && (
                <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <p className="text-sm text-emerald-800">
                    You are authorized to work without sponsorship. Applications will be filled accordingly.
                  </p>
                </div>
              )}
            </Section>

            {/* 04 — Experience & preferences */}
            <Section
              id="experience"
              icon={<Briefcase className="h-4 w-4" />}
              title="Experience & preferences"
              index={4}
            >
              <div className="grid grid-cols-2 gap-4">
                <Field label="Years of experience">
                  <Input
                    type="number"
                    value={form.years_of_experience?.toString() ?? ""}
                    onChange={(v) => set("years_of_experience", v ? parseInt(v, 10) : null)}
                    placeholder="5"
                  />
                </Field>
                <Field label="Earliest start date">
                  <Input
                    value={str(form.earliest_start_date)}
                    onChange={(v) => set("earliest_start_date", v || null)}
                    placeholder="2 weeks notice"
                  />
                </Field>
              </div>

              <Field label="Expected salary range (USD)">
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={form.salary_expectation_min?.toString() ?? ""}
                    onChange={(e) => set("salary_expectation_min", e.target.value ? parseInt(e.target.value, 10) : null)}
                    placeholder="80,000"
                    className={inputCls}
                  />
                  <span className="shrink-0 font-medium text-gray-300">—</span>
                  <input
                    type="number"
                    value={form.salary_expectation_max?.toString() ?? ""}
                    onChange={(e) => set("salary_expectation_max", e.target.value ? parseInt(e.target.value, 10) : null)}
                    placeholder="120,000"
                    className={inputCls}
                  />
                </div>
              </Field>

              <Field label="Preferred work arrangement">
                <PillSelect
                  value={form.preferred_work_type}
                  onChange={(v) => set("preferred_work_type", v)}
                  options={WORK_TYPE_OPTIONS}
                />
              </Field>

              <Field label="Willing to relocate?">
                <PillSelect
                  value={form.willing_to_relocate ? "yes" : "no"}
                  onChange={(v) => set("willing_to_relocate", v === "yes")}
                  options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                />
              </Field>
            </Section>

            {/* 05 — Education */}
            <Section id="education" icon={<BookOpen className="h-4 w-4" />} title="Education" index={5}>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Highest degree">
                  <select
                    value={str(form.highest_degree)}
                    onChange={(e) => set("highest_degree", e.target.value || null)}
                    className={inputCls}
                  >
                    <option value="">Select…</option>
                    {DEGREE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
                <Field label="Field of study">
                  <Input value={str(form.field_of_study)} onChange={(v) => set("field_of_study", v || null)} placeholder="Computer Science" />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="University / College">
                  <Input value={str(form.university)} onChange={(v) => set("university", v || null)} placeholder="MIT" />
                </Field>
                <Field label="Graduation year">
                  <Input
                    type="number"
                    value={form.graduation_year?.toString() ?? ""}
                    onChange={(v) => set("graduation_year", v ? parseInt(v, 10) : null)}
                    placeholder="2022"
                  />
                </Field>
              </div>
              <Field label="GPA" hint="Only include if 3.5 or above — leave blank otherwise.">
                <Input value={str(form.gpa)} onChange={(v) => set("gpa", v || null)} placeholder="3.8" />
              </Field>
            </Section>

            {/* 06 — Pre-written Q&A */}
            <Section
              id="qa"
              icon={<Sparkles className="h-4 w-4" />}
              title="Pre-written answers"
              subtitle="Matched to application questions by keyword patterns"
              index={6}
            >
              <p className="text-xs text-gray-400 -mt-2">
                We match your answers by keyword. If a form contains &ldquo;salary&rdquo; we use your salary answer automatically.
              </p>

              <div className="space-y-3">
                {(form.custom_answers ?? []).map((qa, i) => (
                  <div key={i} className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/70">
                    <div className="border-b border-slate-100 bg-white px-4 py-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                        {QA_LABELS[qa.question_pattern] ?? "Custom pattern"}
                      </p>
                      {!QA_LABELS[qa.question_pattern] && (
                        <div className="mt-2">
                          <Input
                            value={qa.question_pattern}
                            onChange={(v) => {
                              const next = [...(form.custom_answers ?? [])]
                              next[i] = { ...qa, question_pattern: v }
                              set("custom_answers", next)
                            }}
                            placeholder="e.g. why.*team|why.*role"
                          />
                        </div>
                      )}
                    </div>
                    <div className="p-4">
                      <textarea
                        value={qa.answer}
                        onChange={(e) => {
                          const next = [...(form.custom_answers ?? [])]
                          next[i] = { ...qa, answer: e.target.value }
                          set("custom_answers", next)
                        }}
                        rows={3}
                        placeholder="Your pre-written answer (leave blank to skip)"
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition-all placeholder:text-gray-300 focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/12"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() =>
                  set("custom_answers", [
                    ...(form.custom_answers ?? []),
                    { question_pattern: "", answer: "" },
                  ])
                }
                className="text-xs font-semibold text-[#FF5C18] transition-colors hover:text-[#E14F0E]"
              >
                + Add custom Q&amp;A
              </button>
            </Section>

            {/* 07 — EEO & diversity */}
            <Section
              id="diversity"
              icon={<Shield className="h-4 w-4" />}
              title="EEO & diversity"
              subtitle="Optional — controls voluntary diversity questions on applications"
              index={7}
            >
              <p className="text-xs leading-relaxed text-gray-400 -mt-2">
                Most ATS platforms include voluntary EEO questions. Enabling this means Scout will attempt to fill them
                using the values you choose below, fuzzy-matched to whatever options the ATS provides.
              </p>

              {/* Toggle */}
              <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-4">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Auto-fill EEO / diversity questions</p>
                  <p className="mt-0.5 text-xs text-gray-400">We only fill these if you opt in here</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.auto_fill_diversity}
                  onClick={() => set("auto_fill_diversity", !form.auto_fill_diversity)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                    form.auto_fill_diversity ? "bg-[#FF5C18]" : "bg-gray-200"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                      form.auto_fill_diversity ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Gender identity" hint="Used by most EEO forms.">
                  <select value={str(form.gender)} onChange={(e) => set("gender", e.target.value || null)} className={inputCls}>
                    <option value="">Select…</option>
                    {GENDER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Race / ethnicity" hint="EEOC-standard options.">
                  <select value={str(form.ethnicity)} onChange={(e) => set("ethnicity", e.target.value || null)} className={inputCls}>
                    <option value="">Select…</option>
                    {ETHNICITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Veteran status" hint="Required by OFCCP-covered employers.">
                  <select value={str(form.veteran_status)} onChange={(e) => set("veteran_status", e.target.value || null)} className={inputCls}>
                    <option value="">Select…</option>
                    {VETERAN_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Disability status" hint="OFCCP Form CC-305.">
                  <select value={str(form.disability_status)} onChange={(e) => set("disability_status", e.target.value || null)} className={inputCls}>
                    <option value="">Select…</option>
                    {DISABILITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
              </div>

              {!form.auto_fill_diversity && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                  Enable &ldquo;Auto-fill EEO&rdquo; above to have Scout fill these fields.
                  Your selections are saved but won&rsquo;t be used until you opt in.
                </p>
              )}
            </Section>
          </div>
        </div>

        {/* ── Mobile bottom save bar ───────────────────────────────────────────── */}
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200/60 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
          <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="relative h-8 w-8">
                <svg viewBox="0 0 32 32" className="-rotate-90 h-8 w-8">
                  <circle cx="16" cy="16" r="12" fill="none" stroke="#f1f5f9" strokeWidth="3" />
                  <circle
                    cx="16" cy="16" r="12"
                    fill="none"
                    stroke={completion >= 80 ? "#10b981" : completion >= 50 ? "#f59e0b" : "#FF5C18"}
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 12}
                    strokeDashoffset={2 * Math.PI * 12 - (completion / 100) * 2 * Math.PI * 12}
                  />
                </svg>
                <span className={cn("absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums", completionTextColor)}>
                  {completion}
                </span>
              </div>
              <span className="text-sm text-gray-500">complete</span>
            </div>

            <div className="flex items-center gap-3">
              {saveStatus === "saved" && (
                <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Saved
                </span>
              )}
              {saveStatus === "error" && (
                <span className="text-sm font-medium text-red-500">Save failed</span>
              )}
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-[#FF5C18] to-[#FF7A3D] px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-[#FF5C18]/20 transition hover:shadow-lg disabled:opacity-60"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isSaving ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
