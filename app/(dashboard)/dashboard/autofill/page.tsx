"use client"

import { useCallback, useEffect, useState } from "react"
import {
  BookOpen,
  Briefcase,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  Loader2,
  Lock,
  Save,
  Sparkles,
  User,
} from "lucide-react"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useAuth } from "@/lib/hooks/useAuth"
import { cn } from "@/lib/utils"
import type {
  AutofillProfile,
  CustomAnswer,
  PreferredWorkType,
  WorkAuthorization,
} from "@/types"

// ── Completion bar ────────────────────────────────────────────────────────────

function CompletionBar({ pct }: { pct: number }) {
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-400" : "bg-[#0369A1]"
  return (
    <div className="rounded-[32px] border border-white/80 bg-white/90 p-5 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-gray-900">Profile completeness</p>
        <span className={cn("text-sm font-bold", pct >= 80 ? "text-emerald-600" : pct >= 50 ? "text-amber-600" : "text-[#0369A1]")}>
          {pct}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {pct < 100 && (
        <p className="mt-2 text-xs text-gray-400">
          {pct < 50
            ? "Add your basics to enable autofill on most applications."
            : pct < 80
            ? "Almost there — complete the remaining fields to maximize autofill coverage."
            : "Great profile! You're ready to autofill most applications."}
        </p>
      )}
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  subtitle,
  children,
  defaultOpen = true,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-[32px] border border-white/80 bg-white/90 shadow-[0_4px_24px_rgba(15,23,42,0.06)] overflow-hidden">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-6 py-5 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#0369A1]">
          {icon}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-gray-900">{title}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>
      {open && <div className="px-6 pb-6 space-y-4">{children}</div>}
    </div>
  )
}

// ── Field helpers ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  )
}

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
      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] placeholder:text-gray-400"
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
            "rounded-xl border px-3.5 py-2 text-sm font-medium transition",
            value === opt.value
              ? "border-[#0369A1] bg-[#F0F9FF] text-[#0369A1]"
              : "border-gray-200 text-gray-600 hover:border-gray-300"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Default sponsorship statement by visa status ──────────────────────────────

function defaultSponsorshipStatement(visaStatus: string, optEndDate?: string | null): string {
  const dateStr = optEndDate
    ? new Date(optEndDate).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "the current period"

  if (visaStatus === "opt") {
    return `I am currently authorized to work in the US on OPT, valid until ${dateStr}. I will require H1B sponsorship and am actively seeking employers who can sponsor. I am happy to discuss timing and the process.`
  }
  if (visaStatus === "stem_opt") {
    return `I am currently on STEM OPT, valid until ${dateStr}, giving me up to 3 years of work authorization. I will eventually require H1B sponsorship and look forward to discussing this with you.`
  }
  if (visaStatus === "h1b") {
    return `I currently hold an H1B visa and would require transfer sponsorship. I am happy to facilitate this process and can provide all necessary documentation.`
  }
  return `I will require visa sponsorship to work in the US. I am happy to discuss my work authorization status and the sponsorship process at any stage.`
}

// ── Work authorization options ────────────────────────────────────────────────

const WORK_AUTH_OPTIONS: Array<{ value: WorkAuthorization; label: string }> = [
  { value: "us_citizen", label: "US Citizen or Permanent Resident" },
  { value: "green_card", label: "Green Card holder" },
  { value: "h1b", label: "H1B Visa" },
  { value: "opt", label: "Currently on OPT" },
  { value: "stem_opt", label: "Currently on STEM OPT" },
  { value: "tn_visa", label: "TN Visa" },
  { value: "other", label: "Other work visa" },
  { value: "require_sponsorship", label: "Require sponsorship" },
]

const WORK_TYPE_OPTIONS: Array<{ value: PreferredWorkType; label: string }> = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
  { value: "flexible", label: "Flexible" },
]

const DEGREE_OPTIONS = [
  "High School / GED", "Associate's", "Bachelor's", "Master's",
  "MBA", "PhD", "JD", "MD", "Other",
]

// ── Default custom Q&A ────────────────────────────────────────────────────────

const DEFAULT_QA: CustomAnswer[] = [
  { question_pattern: "why.*company|why.*want.*work|what.*draws.*you", answer: "" },
  { question_pattern: "tell.*yourself|about.*yourself|background", answer: "" },
  { question_pattern: "salary|compensation|pay.*expect", answer: "" },
  { question_pattern: "greatest.*achievement|proudest.*accomplishment", answer: "" },
  { question_pattern: "overtime|travel.*role|willing.*travel", answer: "" },
]

const QA_LABELS: Record<string, string> = {
  "why.*company|why.*want.*work|what.*draws.*you": "Why do you want to work here?",
  "tell.*yourself|about.*yourself|background": "Tell me about yourself",
  "salary|compensation|pay.*expect": "What are your salary expectations?",
  "greatest.*achievement|proudest.*accomplishment": "Greatest professional achievement",
  "overtime|travel.*role|willing.*travel": "Willing to work overtime / travel?",
}

// ── Main page ─────────────────────────────────────────────────────────────────

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

export default function AutofillPage() {
  const { profile: authProfile } = useAuth()
  const { primaryResume } = useResumeContext()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle")
  const [isImprovingStatement, setIsImprovingStatement] = useState(false)
  const [showAddress, setShowAddress] = useState(false)
  const [showDiversity, setShowDiversity] = useState(false)

  const completion = calcLocalCompletion(form)

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const str = (v: string | null | undefined) => v ?? ""

  // Load existing profile + pre-populate from resume
  useEffect(() => {
    async function load() {
      const res = await fetch("/api/autofill/profile")
      if (!res.ok) return
      const { profile: autofillProfile } = await res.json() as { profile: AutofillProfile | null }

      if (autofillProfile) {
        setProfileId(autofillProfile.id)
        const { id, user_id, created_at, updated_at, ...rest } = autofillProfile
        setForm({ ...EMPTY_FORM, ...rest })
        setShowDiversity(autofillProfile.auto_fill_diversity)
      } else if (primaryResume?.parse_status === "complete") {
        // Pre-populate from resume
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

  // Auto-populate sponsorship statement when auth changes
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
        body: JSON.stringify({
          statement: form.sponsorship_statement,
          visaStatus: form.work_authorization,
        }),
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
    try {
      const method = profileId ? "PATCH" : "POST"
      const res = await fetch("/api/autofill/profile", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const data = await res.json() as { profile?: AutofillProfile }
      if (!res.ok) throw new Error("Save failed")
      if (data.profile && !profileId) setProfileId(data.profile.id)
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus("idle"), 3000)
    } catch {
      setSaveStatus("error")
    } finally {
      setIsSaving(false)
    }
  }, [profileId, form])

  const needsSponsorship = ["opt", "stem_opt", "h1b", "require_sponsorship"].includes(
    form.work_authorization ?? ""
  )

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(3,105,161,0.08),_transparent_40%),linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_60%,#F8FAFC_100%)] px-4 py-6 pb-28 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Your autofill profile</h1>
          <p className="mt-1 text-sm text-gray-500">
            Fill this out once. We&rsquo;ll use it to fill job applications across Greenhouse, Lever, Workday, Ashby, and more.
          </p>
        </div>

        <CompletionBar pct={completion} />

        {/* Section 1 — Personal info */}
        <Section icon={<User className="h-4 w-4" />} title="Personal information">
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
            className="text-sm font-medium text-[#0369A1] hover:text-[#075985]"
          >
            {showAddress ? "Hide address" : "+ Add address (optional)"}
          </button>

          {showAddress && (
            <div className="space-y-4 pt-1">
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

        {/* Section 2 — Professional links */}
        <Section
          icon={<Globe className="h-4 w-4" />}
          title="Professional links"
          subtitle="Used to fill LinkedIn, GitHub, portfolio fields automatically"
        >
          {[
            { key: "linkedin_url" as const, label: "LinkedIn URL", placeholder: "https://linkedin.com/in/janesmith" },
            { key: "github_url" as const, label: "GitHub URL", placeholder: "https://github.com/janesmith" },
            { key: "portfolio_url" as const, label: "Portfolio / website", placeholder: "https://janesmith.dev" },
            { key: "website_url" as const, label: "Other website", placeholder: "https://blog.example.com" },
          ].map(({ key, label, placeholder }) => (
            <Field key={key} label={label}>
              <div className="flex gap-2">
                <Input value={str(form[key])} onChange={(v) => set(key, v || null)} placeholder={placeholder} />
                {form[key] && (
                  <a
                    href={str(form[key])}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center rounded-xl border border-gray-200 px-3 text-gray-500 transition hover:border-gray-300 hover:text-gray-800"
                  >
                    <span className="hidden text-xs font-medium sm:inline">Test link</span>
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            </Field>
          ))}
        </Section>

        {/* Section 3 — Work authorization */}
        <Section
          icon={<Lock className="h-4 w-4" />}
          title="Work authorization"
          subtitle="Critical — affects every application"
          defaultOpen
        >
          <Field label="Work authorization status">
            <select
              value={form.work_authorization ?? ""}
              onChange={(e) => set("work_authorization", (e.target.value as WorkAuthorization) || null)}
              className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] bg-white"
            >
              <option value="">Select status…</option>
              {WORK_AUTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </Field>

          {needsSponsorship && (
            <div className="rounded-2xl border border-[#BAE6FD] bg-[#F0F9FF] p-4 space-y-3">
              <div>
                <p className="text-sm font-semibold text-[#0C4A6E] mb-1">Your sponsorship statement</p>
                <p className="text-xs text-[#0369A1]">
                  This is what we&rsquo;ll use when applications ask about visa sponsorship.
                  Edit it to sound like you.
                </p>
              </div>
              <textarea
                value={str(form.sponsorship_statement)}
                onChange={(e) => set("sponsorship_statement", e.target.value || null)}
                rows={4}
                className="w-full resize-none rounded-xl border border-sky-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1]"
                placeholder="I am currently authorized to work on OPT…"
              />
              <button
                type="button"
                onClick={() => void improveStatement()}
                disabled={isImprovingStatement || !form.sponsorship_statement}
                className="flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-3.5 py-2 text-xs font-semibold text-[#0369A1] transition hover:bg-sky-50 disabled:opacity-50"
              >
                {isImprovingStatement ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {isImprovingStatement ? "Improving…" : "Improve with AI"}
              </button>
            </div>
          )}

          {!needsSponsorship && form.work_authorization && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              ✓ You are authorized to work without sponsorship. Applications will be filled accordingly.
            </div>
          )}
        </Section>

        {/* Section 4 — Experience & preferences */}
        <Section
          icon={<Briefcase className="h-4 w-4" />}
          title="Experience & preferences"
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
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] placeholder:text-gray-400"
              />
              <span className="text-gray-400 text-sm">to</span>
              <input
                type="number"
                value={form.salary_expectation_max?.toString() ?? ""}
                onChange={(e) => set("salary_expectation_max", e.target.value ? parseInt(e.target.value, 10) : null)}
                placeholder="120,000"
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] placeholder:text-gray-400"
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

        {/* Section 5 — Education */}
        <Section
          icon={<BookOpen className="h-4 w-4" />}
          title="Education"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Highest degree">
              <select
                value={str(form.highest_degree)}
                onChange={(e) => set("highest_degree", e.target.value || null)}
                className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-900 outline-none focus:border-[#0369A1] bg-white"
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
          <Field label="GPA (optional)" hint="Only include if 3.5 or above — otherwise leave blank.">
            <Input value={str(form.gpa)} onChange={(v) => set("gpa", v || null)} placeholder="3.8" />
          </Field>
        </Section>

        {/* Section 6 — Custom Q&A */}
        <Section
          icon={<Sparkles className="h-4 w-4" />}
          title="Pre-written answers"
          subtitle="We match these to common application questions by keywords"
          defaultOpen={false}
        >
          <p className="text-xs text-gray-500 -mt-2">
            We match your answers to questions using keywords. If a form question contains &ldquo;salary&rdquo; we use your salary answer automatically.
          </p>
          {(form.custom_answers ?? []).map((qa, i) => (
            <div key={i} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-2">
              <p className="text-xs font-semibold text-gray-700">
                {QA_LABELS[qa.question_pattern] ?? "Custom question pattern"}
              </p>
              {!QA_LABELS[qa.question_pattern] && (
                <Input
                  value={qa.question_pattern}
                  onChange={(v) => {
                    const next = [...(form.custom_answers ?? [])]
                    next[i] = { ...qa, question_pattern: v }
                    set("custom_answers", next)
                  }}
                  placeholder="e.g. why.*team|why.*role"
                />
              )}
              <textarea
                value={qa.answer}
                onChange={(e) => {
                  const next = [...(form.custom_answers ?? [])]
                  next[i] = { ...qa, answer: e.target.value }
                  set("custom_answers", next)
                }}
                rows={3}
                placeholder="Your pre-written answer (leave blank to skip this question)"
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1] placeholder:text-gray-400"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              set("custom_answers", [
                ...(form.custom_answers ?? []),
                { question_pattern: "", answer: "" },
              ])
            }
            className="text-sm font-medium text-[#0369A1] hover:text-[#075985]"
          >
            + Add custom Q&amp;A
          </button>
        </Section>

        {/* Section 7 — Diversity */}
        <Section
          icon={<User className="h-4 w-4" />}
          title="Diversity & inclusion"
          subtitle="Optional — only filled if you turn it on"
          defaultOpen={false}
        >
          <p className="text-xs text-gray-500 -mt-2">
            Many applications include optional diversity questions. These are always voluntary — you control whether we fill them.
          </p>
          <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
            <span className="text-sm font-medium text-gray-700">Auto-fill diversity questions</span>
            <button
              type="button"
              role="switch"
              aria-checked={form.auto_fill_diversity}
              onClick={() => {
                set("auto_fill_diversity", !form.auto_fill_diversity)
                setShowDiversity(!form.auto_fill_diversity)
              }}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition",
                form.auto_fill_diversity ? "bg-[#0369A1]" : "bg-gray-200"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition",
                  form.auto_fill_diversity ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {showDiversity && form.auto_fill_diversity && (
            <div className="space-y-4 pt-1">
              {[
                { key: "gender" as const, label: "Gender identity", placeholder: "e.g. Woman, Man, Non-binary, Prefer not to say" },
                { key: "ethnicity" as const, label: "Ethnicity / race", placeholder: "e.g. Asian, Hispanic, White, Prefer not to say" },
                { key: "veteran_status" as const, label: "Veteran status", placeholder: "e.g. Not a veteran, Veteran, Prefer not to say" },
                { key: "disability_status" as const, label: "Disability status", placeholder: "e.g. No disability, Have a disability, Prefer not to say" },
              ].map(({ key, label, placeholder }) => (
                <Field key={key} label={label}>
                  <Input value={str(form[key])} onChange={(v) => set(key, v || null)} placeholder={placeholder} />
                </Field>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Fixed save bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-gray-100 bg-white/95 backdrop-blur-sm px-4 py-4">
        <div className="mx-auto max-w-3xl flex items-center justify-between gap-4">
          <div className="text-sm text-gray-500 hidden sm:block">
            Profile is <span className="font-semibold text-gray-900">{completion}%</span> complete
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {saveStatus === "saved" && (
              <span className="text-sm font-medium text-emerald-600">✓ Profile saved — autofill is ready</span>
            )}
            {saveStatus === "error" && (
              <span className="text-sm font-medium text-red-600">Save failed — try again</span>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-2xl bg-[#0369A1] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985] disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? "Saving…" : "Save autofill profile"}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}

function salaryExpectationAnswer(min: number | null, max: number | null) {
  if (min && max) {
    return `I am targeting a base salary in the $${min.toLocaleString()} to $${max.toLocaleString()} range, depending on scope, level, and total compensation.`
  }
  if (min) {
    return `I am targeting a base salary starting around $${min.toLocaleString()}, depending on scope and total compensation.`
  }
  return ""
}
