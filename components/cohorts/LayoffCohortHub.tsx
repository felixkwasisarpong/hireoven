"use client"

import { useCallback, useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import type { CohortListItem } from "@/app/api/cohorts/route"

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "cohorts" | "my" | "employers"

type MyCohortMember = {
  id: string
  roleTitle: string
  department: string
  yearsExperience: number
  skills: string[]
  isVisible: boolean
  vouchesReceived: number
  vouchesGiven: number
  joinedAt: string
}

type EmployerRequest = {
  id: string
  cohort_id?: string
  company_name: string
  roles_needed: string[]
  headcount_requested: number
  message: string | null
  status: string
  created_at: string
}

type MyCohort = {
  cohortId: string
  companyName: string
  department: string | null
  layoffDate: string
  status: string
  memberCount: number
  strengthScore: number
  employerRequestCount: number
  topSkills: string[]
  member: MyCohortMember
  employerRequests: EmployerRequest[]
  userInterests: Record<string, string>
}

type CohortDetail = {
  cohort: CohortListItem & { company_id: string }
  members: CohortMember[]
  employerRequests: EmployerRequest[]
  callerIsMember: boolean
}

type CohortMember = {
  id: string
  user_id: string | null
  role_title: string
  department: string
  years_experience: number
  current_salary: number | null
  skills: string[]
  linkedin_url: string | null
  is_visible: boolean
  vouches_received: number
  vouches_given: number
  joined_at: string
  full_name: string | null
}

type JoinStep = 1 | 2 | 3
type JoinState = {
  cohortId: string
  roleTitle: string
  department: string
  yearsExperience: string
  currentSalary: string
  skills: string[]
  isVisible: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", day: "numeric" })
}

function initials(name: string | null) {
  if (!name) return "?"
  const parts = name.trim().split(" ").filter(Boolean)
  return parts.length >= 2
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : (parts[0]?.[0] ?? "?").toUpperCase()
}

function avatarColor(name: string | null) {
  const colors = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6"]
  const n = (name ?? "?").charCodeAt(0) % colors.length
  return colors[n]
}

// ── Material Icon shim ────────────────────────────────────────────────────────

function MI({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  return (
    <span className={cn("material-icons select-none leading-none", className)} style={style} aria-hidden>
      {name}
    </span>
  )
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  forming:  "bg-slate-100 text-slate-600",
  active:   "bg-emerald-50 text-emerald-700 border border-emerald-200",
  matching: "bg-sky-50 text-sky-700 border border-sky-200",
  closed:   "bg-slate-100 text-slate-400",
}
const STATUS_LABELS: Record<string, string> = {
  forming: "Forming", active: "Active", matching: "Matching", closed: "Closed",
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLES[status] ?? STATUS_STYLES.forming)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ── Strength bar ──────────────────────────────────────────────────────────────

function StrengthBar({ score }: { score: number }) {
  const color = score >= 75 ? "#16a34a" : score >= 50 ? "#d97706" : score >= 25 ? "#ea580c" : "#94a3b8"
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-[12px] font-semibold tabular-nums" style={{ color }}>{score}</span>
    </div>
  )
}

// ── Stat cell ─────────────────────────────────────────────────────────────────

function StatCell({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[16px] font-bold tabular-nums text-slate-900">{value ?? "—"}</span>
      <span className="text-[11px] text-slate-400">{label}</span>
    </div>
  )
}

// ── Cohort Card (Tab 1) ───────────────────────────────────────────────────────

function CohortCard({
  cohort,
  isMember,
  onJoin,
  onView,
}: {
  cohort: CohortListItem
  isMember: boolean
  onJoin: (id: string) => void
  onView: (id: string) => void
}) {
  const isHot = cohort.strength_score >= 60

  return (
    <div className="border-b border-[var(--color-border,#E2E8F0)] pb-5 last:border-0">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold text-slate-900">
              {cohort.company_name}
              {cohort.department ? ` · ${cohort.department}` : ""}
            </span>
            <StatusPill status={cohort.status} />
            {isHot && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <MI name="bolt" className="text-[12px]" />
                Hot cohort
              </span>
            )}
          </div>
          <p className="text-[13px] text-slate-400 mt-0.5">
            Layoff: {formatDate(cohort.layoff_date)}
          </p>
        </div>
        <StrengthBar score={cohort.strength_score} />
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-0 mb-3">
        {[
          { label: "members", value: cohort.member_count },
          { label: "avg salary", value: cohort.avg_salary_usd ? `$${Math.round(cohort.avg_salary_usd / 1000)}k` : null },
          { label: "avg exp", value: cohort.avg_years_experience ? `${Number(cohort.avg_years_experience).toFixed(1)}yr` : null },
          { label: "employer requests", value: cohort.employer_request_count },
        ].map((s, i) => (
          <div key={i} className="flex items-center">
            {i > 0 && <span className="mx-3 h-4 w-px bg-slate-200" />}
            <StatCell label={s.label} value={s.value} />
          </div>
        ))}
      </div>

      {/* Skills */}
      {cohort.top_skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {cohort.top_skills.slice(0, 8).map((skill, i) => (
            <span
              key={skill}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[12px] font-medium",
                i < 4
                  ? "bg-sky-50 text-sky-700 border border-sky-200"
                  : "bg-slate-100 text-slate-500"
              )}
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        {isMember ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-4 py-1.5 text-[13px] font-semibold text-emerald-700">
            <MI name="check_circle" className="text-[15px]" />
            You're in this cohort
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onJoin(cohort.id)}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-1.5 text-[13px] font-semibold text-white hover:bg-emerald-700 transition-colors"
          >
            <MI name="group_add" className="text-[15px]" />
            Join this cohort
          </button>
        )}
        <button
          type="button"
          onClick={() => onView(cohort.id)}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-4 py-1.5 text-[13px] font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors"
        >
          View members
        </button>
      </div>
    </div>
  )
}

// ── Join Flow ─────────────────────────────────────────────────────────────────

const SKILL_SUGGESTIONS = [
  "Python","TypeScript","React","Node.js","SQL","AWS","Kubernetes","Go","Java","Rust",
  "Machine Learning","Data Analysis","Product Management","Sales","Marketing","Design",
  "Finance","Operations","Customer Success","Engineering Management",
]

const DEPT_OPTIONS = ["Engineering","Design","Sales","Data","Operations","Marketing","Finance","Product","Other"]

function JoinModal({
  cohort,
  onClose,
  onSuccess,
}: {
  cohort: CohortListItem
  onClose: () => void
  onSuccess: () => void
}) {
  const [step, setStep] = useState<JoinStep>(1)
  const [form, setForm] = useState<Omit<JoinState, "cohortId">>({
    roleTitle: "",
    department: cohort.department ?? "",
    yearsExperience: "",
    currentSalary: "",
    skills: [],
    isVisible: true,
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleSkill(skill: string) {
    setForm((f) => ({
      ...f,
      skills: f.skills.includes(skill)
        ? f.skills.filter((s) => s !== skill)
        : [...f.skills, skill],
    }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/cohorts/${cohort.id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleTitle: form.roleTitle,
          department: form.department,
          yearsExperience: parseInt(form.yearsExperience, 10) || 0,
          currentSalary: form.currentSalary ? parseInt(form.currentSalary, 10) : null,
          skills: form.skills,
          isVisible: form.isVisible,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? "Failed to join")
      }
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-md bg-white rounded-2xl p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-700"
        >
          <MI name="close" className="text-[20px]" />
        </button>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-5">
          {([1,2,3] as JoinStep[]).map((s) => (
            <div key={s} className="flex items-center gap-1">
              <span
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold",
                  step === s
                    ? "bg-emerald-600 text-white"
                    : step > s
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-400"
                )}
              >{s}</span>
              {s < 3 && <div className="w-6 h-px bg-slate-200" />}
            </div>
          ))}
          <span className="ml-2 text-[13px] text-slate-500">
            {step === 1 ? "Confirm cohort" : step === 2 ? "Your details" : "Privacy"}
          </span>
        </div>

        {/* Step 1 */}
        {step === 1 && (
          <div>
            <p className="text-[13px] text-slate-500 mb-1">You are joining</p>
            <p className="text-[17px] font-bold text-slate-900 mb-1">
              {cohort.company_name}{cohort.department ? ` · ${cohort.department}` : ""}
            </p>
            <p className="text-[13px] text-slate-500 mb-6">
              Layoff date: {formatDate(cohort.layoff_date)} · {cohort.member_count} members
            </p>
            <p className="text-[13px] text-slate-600 leading-relaxed mb-6">
              This cohort connects former {cohort.company_name} employees so you can job-hunt
              together, vouch for each other, and attract employers looking to hire from your team.
            </p>
            <button
              type="button"
              onClick={() => setStep(2)}
              className="w-full rounded-lg bg-emerald-600 py-2.5 text-[14px] font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              This is the right cohort →
            </button>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Role title</label>
              <input
                type="text"
                placeholder="e.g. Senior Software Engineer"
                value={form.roleTitle}
                onChange={(e) => setForm((f) => ({ ...f, roleTitle: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-emerald-400"
              />
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1">Department</label>
              <div className="flex flex-wrap gap-1.5">
                {DEPT_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, department: d }))}
                    className={cn(
                      "rounded-full px-3 py-1 text-[12px] font-medium border transition-colors",
                      form.department === d
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    )}
                  >{d}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">Years experience</label>
                <input
                  type="number"
                  min={0}
                  max={50}
                  placeholder="5"
                  value={form.yearsExperience}
                  onChange={(e) => setForm((f) => ({ ...f, yearsExperience: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-emerald-400"
                />
              </div>
              <div className="flex-1">
                <label className="block text-[12px] font-semibold text-slate-600 mb-1">Salary (optional)</label>
                <input
                  type="number"
                  placeholder="120000"
                  value={form.currentSalary}
                  onChange={(e) => setForm((f) => ({ ...f, currentSalary: e.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-emerald-400"
                />
              </div>
            </div>
            <div>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Skills</label>
              <div className="flex flex-wrap gap-1.5">
                {SKILL_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleSkill(s)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[12px] font-medium border transition-colors",
                      form.skills.includes(s)
                        ? "border-sky-400 bg-sky-50 text-sky-700"
                        : "border-slate-200 text-slate-500 hover:border-slate-300"
                    )}
                  >{s}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setStep(1)} className="flex-1 rounded-lg border border-slate-200 py-2 text-[14px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">Back</button>
              <button
                type="button"
                disabled={!form.roleTitle.trim() || !form.department}
                onClick={() => setStep(3)}
                className={cn("flex-1 rounded-lg py-2 text-[14px] font-semibold text-white transition-colors", form.roleTitle.trim() && form.department ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-200 cursor-not-allowed")}
              >Next →</button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div>
            <p className="text-[15px] font-semibold text-slate-900 mb-4">Privacy settings</p>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setForm((f) => ({ ...f, isVisible: true }))}
              onKeyDown={(e) => e.key === "Enter" && setForm((f) => ({ ...f, isVisible: true }))}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 mb-3 cursor-pointer transition-colors",
                form.isVisible ? "border-emerald-400 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
              )}
            >
              <MI name="visibility" className="text-[20px] mt-0.5 text-emerald-600 shrink-0" />
              <div>
                <p className="text-[14px] font-semibold text-slate-900 mb-0.5">Visible</p>
                <p className="text-[13px] text-slate-500">Other members see your first name and role. Employers see your full profile.</p>
              </div>
            </div>
            <div
              role="button"
              tabIndex={0}
              onClick={() => setForm((f) => ({ ...f, isVisible: false }))}
              onKeyDown={(e) => e.key === "Enter" && setForm((f) => ({ ...f, isVisible: false }))}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 mb-4 cursor-pointer transition-colors",
                !form.isVisible ? "border-slate-700 bg-slate-50" : "border-slate-200 hover:border-slate-300"
              )}
            >
              <MI name="visibility_off" className="text-[20px] mt-0.5 text-slate-600 shrink-0" />
              <div>
                <p className="text-[14px] font-semibold text-slate-900 mb-0.5">Anonymous</p>
                <p className="text-[13px] text-slate-500">Only you and employers who match you see your full profile. Other members see you as "Member".</p>
              </div>
            </div>
            {error && <p className="text-[13px] text-red-500 mb-3">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => setStep(2)} className="flex-1 rounded-lg border border-slate-200 py-2 text-[14px] font-medium text-slate-600 hover:bg-slate-50 transition-colors">Back</button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="flex-1 rounded-lg bg-emerald-600 py-2 text-[14px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Joining…" : "Join cohort"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Cohort Detail Modal ───────────────────────────────────────────────────────

function CohortDetailModal({
  detail,
  currentUserId,
  onClose,
  onVouch,
}: {
  detail: CohortDetail
  currentUserId: string | null
  onClose: () => void
  onVouch: (memberId: string, memberName: string) => void
}) {
  const { cohort, members, employerRequests, callerIsMember } = detail

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="relative w-full max-w-xl bg-white rounded-2xl p-6 shadow-xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-slate-400 hover:text-slate-700">
          <MI name="close" className="text-[20px]" />
        </button>

        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
          {cohort.department ?? "Cohort"}
        </p>
        <h2 className="text-[18px] font-bold text-slate-900 mb-1">{cohort.company_name}</h2>
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <StatusPill status={cohort.status} />
          <span className="text-[13px] text-slate-400">{formatDate(cohort.layoff_date)}</span>
          <span className="text-[13px] text-slate-400">·</span>
          <span className="text-[13px] text-slate-500">{cohort.member_count} members</span>
        </div>

        {members.length > 0 && (
          <div className="mb-5">
            <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Members</p>
            <div className="space-y-3">
              {members.map((m) => {
                const isOwn = m.user_id === currentUserId
                return (
                  <div key={m.id} className="flex items-start gap-3">
                    <div
                      className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[12px] font-bold text-white"
                      style={{ background: avatarColor(m.full_name) }}
                    >
                      {initials(m.full_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-slate-900">{m.full_name ?? "Member"}</p>
                      <p className="text-[12px] text-slate-500">{m.role_title} · {m.years_experience}yr exp</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.skills.slice(0, 4).map((s) => (
                          <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{s}</span>
                        ))}
                        {m.vouches_received > 0 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] text-emerald-700">
                            <MI name="verified" className="text-[11px]" />
                            {m.vouches_received} vouch{m.vouches_received !== 1 ? "es" : ""}
                          </span>
                        )}
                      </div>
                    </div>
                    {callerIsMember && !isOwn && m.user_id && (
                      <button
                        type="button"
                        onClick={() => onVouch(m.user_id!, m.full_name ?? "Member")}
                        className="shrink-0 inline-flex items-center gap-1 rounded-full border border-emerald-200 px-3 py-1 text-[12px] font-medium text-emerald-700 hover:bg-emerald-50 transition-colors"
                      >
                        <MI name="verified" className="text-[13px]" />
                        Vouch
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {employerRequests.length > 0 && (
          <div>
            <p className="text-[13px] font-semibold text-slate-500 uppercase tracking-wide mb-3">Employer requests</p>
            <div className="space-y-3">
              {employerRequests.map((req) => (
                <div key={req.id} className="flex items-start gap-2.5">
                  <MI name="business" className="text-[18px] text-slate-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[14px] font-semibold text-slate-900">{req.company_name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {req.roles_needed.map((r) => (
                        <span key={r} className="rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] text-sky-700">{r}</span>
                      ))}
                    </div>
                    {req.message && <p className="mt-1 text-[12px] text-slate-500 line-clamp-2">{req.message}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Vouch Modal ───────────────────────────────────────────────────────────────

function VouchModal({
  cohortId,
  voucheeId,
  voucheeName,
  onClose,
  onSuccess,
}: {
  cohortId: string
  voucheeId: string
  voucheeName: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [relationship, setRelationship] = useState("")
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const RELATIONSHIPS = ["Worked directly", "Same team", "Cross-functional"]

  async function submit() {
    if (!relationship) { setError("Please select a relationship"); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/cohorts/${cohortId}/vouch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voucheeId, relationship, note: note.trim() || null }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? "Failed")
      }
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 text-slate-400 hover:text-slate-700">
          <MI name="close" className="text-[18px]" />
        </button>
        <p className="text-[15px] font-semibold text-slate-900 mb-1">Vouch for {voucheeName}</p>
        <p className="text-[13px] text-slate-500 mb-4">Your vouch is visible to the entire cohort and to employers.</p>

        <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">How did you work together?</label>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {RELATIONSHIPS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRelationship(r)}
              className={cn(
                "rounded-full px-3 py-1 text-[12px] font-medium border transition-colors",
                relationship === r ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600 hover:border-slate-300"
              )}
            >{r}</button>
          ))}
        </div>

        <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Short endorsement (optional)</label>
        <textarea
          placeholder="e.g. Great communicator, shipped X feature under pressure..."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-400 resize-none mb-4"
        />

        {error && <p className="text-[13px] text-red-500 mb-3">{error}</p>}
        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          className="w-full rounded-lg bg-emerald-600 py-2 text-[14px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          {submitting ? "Sending vouch…" : "Send vouch"}
        </button>
      </div>
    </div>
  )
}

// ── Tab 1 — Active Cohorts ────────────────────────────────────────────────────

function ActiveCohortsTab({
  cohorts,
  loading,
  error,
  joinedCohortIds,
  onJoin,
  onView,
}: {
  cohorts: CohortListItem[]
  loading: boolean
  error: string | null
  joinedCohortIds: Set<string>
  onJoin: (id: string) => void
  onView: (id: string) => void
}) {
  return (
    <div>
      {/* Alert banner */}
      <div className="mb-6 flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
        <MI name="campaign" className="text-[20px] text-emerald-600 shrink-0" />
        <p className="flex-1 text-[14px] text-emerald-800 font-medium">
          Were you recently laid off? Join your cohort and job-hunt as a group.
        </p>
        <MI name="arrow_forward" className="text-[18px] text-emerald-600 shrink-0" />
      </div>

      {loading && (
        <div className="space-y-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-5 w-48 animate-pulse rounded bg-slate-100" />
              <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
              <div className="h-8 w-full animate-pulse rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-[14px] text-red-500">{error}</p>}

      {!loading && !error && cohorts.length === 0 && (
        <div className="py-12 text-center">
          <MI name="groups" className="text-[40px] text-slate-300 mb-3" />
          <p className="text-[14px] text-slate-500">No active cohorts yet. Check back as layoffs are detected.</p>
        </div>
      )}

      <div className="space-y-6">
        {cohorts.map((c) => (
          <CohortCard key={c.id} cohort={c} isMember={joinedCohortIds.has(c.id)} onJoin={onJoin} onView={onView} />
        ))}
      </div>
    </div>
  )
}

// ── Tab 2 — My Cohort ─────────────────────────────────────────────────────────

function MyCohortTab({
  cohorts,
  loading,
  onSwitchToActive,
  onVouch,
}: {
  cohorts: MyCohort[]
  loading: boolean
  onSwitchToActive: () => void
  onVouch: (cohortId: string, userId: string, name: string) => void
}) {
  const [interests, setInterests] = useState<Record<string, boolean>>({})
  const [interestLoading, setInterestLoading] = useState<string | null>(null)

  async function expressInterest(cohortId: string, requestId: string) {
    setInterestLoading(requestId)
    try {
      await fetch(`/api/cohorts/${cohortId}/express-interest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employerRequestId: requestId }),
      })
      setInterests((prev) => ({ ...prev, [requestId]: true }))
    } catch { /* ignore */ }
    finally { setInterestLoading(null) }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded bg-slate-100" />)}
      </div>
    )
  }

  if (cohorts.length === 0) {
    return (
      <div className="py-12 text-center">
        <MI name="group_off" className="text-[40px] text-slate-300 mb-3" />
        <p className="text-[15px] font-semibold text-slate-700 mb-2">You haven&apos;t joined a cohort yet</p>
        <p className="text-[13px] text-slate-500 mb-5">Join a cohort from the Active Cohorts tab to see your group here.</p>
        <button
          type="button"
          onClick={onSwitchToActive}
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 transition-colors"
        >
          <MI name="groups" className="text-[15px]" />
          Browse active cohorts
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {cohorts.map((mc) => (
        <div key={mc.cohortId}>
          {/* Hero */}
          <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-400 mb-1">You are part of this cohort</p>
          <h2 className="text-[18px] font-bold text-slate-900">
            {mc.companyName}{mc.department ? ` · ${mc.department}` : ""}
          </h2>
          <p className="text-[13px] text-slate-400 mb-4">
            Joined {formatDate(mc.member.joinedAt)}
          </p>

          {/* Stats row */}
          <div className="flex items-center gap-0 mb-6 pb-4 border-b border-slate-100">
            {[
              { label: "members", value: mc.memberCount },
              { label: "employer requests", value: mc.employerRequestCount },
              { label: "cohort strength", value: mc.strengthScore },
              { label: "your vouches", value: mc.member.vouchesReceived },
            ].map((s, i) => (
              <div key={i} className="flex items-center flex-1">
                {i > 0 && <div className="mr-4 h-6 w-px bg-slate-200" />}
                <StatCell label={s.label} value={s.value} />
              </div>
            ))}
          </div>

          {/* Employer requests */}
          {mc.employerRequests.length > 0 && (
            <div className="mb-6">
              <p className="text-[14px] font-semibold text-slate-700 mb-3">Employer requests</p>
              <div className="space-y-3">
                {mc.employerRequests.map((req) => {
                  const interested = interests[req.id] || mc.userInterests[req.id] === "interested"
                  return (
                    <div key={req.id} className="flex items-start gap-3">
                      <MI name="business" className="text-[18px] text-slate-400 mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-semibold text-slate-900">{req.company_name}</p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {req.roles_needed.map((r) => (
                            <span key={r} className="rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[11px] text-sky-700">{r}</span>
                          ))}
                        </div>
                        {req.message && <p className="mt-1 text-[12px] text-slate-500 line-clamp-2">{req.message}</p>}
                      </div>
                      {interested ? (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[12px] text-emerald-600 font-medium">
                          <MI name="check_circle" className="text-[14px]" />
                          Interested
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={interestLoading === req.id}
                          onClick={() => expressInterest(mc.cohortId, req.id)}
                          className="shrink-0 text-[12px] font-semibold text-[var(--color-primary,#2563eb)] hover:underline disabled:opacity-50"
                        >
                          Express interest →
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Tab 3 — For Employers ─────────────────────────────────────────────────────

function ForEmployersTab({ cohorts }: { cohorts: CohortListItem[] }) {
  const [selectedCohortId, setSelectedCohortId] = useState("")
  const [form, setForm] = useState({
    companyName: "",
    contactEmail: "",
    rolesNeeded: [] as string[],
    headcount: "1",
    message: "",
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ROLE_OPTIONS = ["Software Engineer","Senior Engineer","Engineering Manager","Data Scientist","Product Manager","Designer","Sales","Marketing","Operations","Finance","Customer Success"]

  function toggleRole(r: string) {
    setForm((f) => ({
      ...f,
      rolesNeeded: f.rolesNeeded.includes(r) ? f.rolesNeeded.filter((x) => x !== r) : [...f.rolesNeeded, r],
    }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCohortId) { setError("Please select a cohort"); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/cohorts/${selectedCohortId}/employer-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName,
          contactEmail: form.contactEmail,
          rolesNeeded: form.rolesNeeded,
          headcountRequested: parseInt(form.headcount, 10) || 1,
          message: form.message || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? "Failed to submit")
      }
      setSubmitted(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="py-12 text-center">
        <MI name="check_circle" className="text-[48px] text-emerald-500 mb-3" />
        <p className="text-[17px] font-bold text-slate-900 mb-2">Request received</p>
        <p className="text-[14px] text-slate-500">We&apos;ll connect you with matching cohort members within 48 hours.</p>
      </div>
    )
  }

  return (
    <div>
      {/* Intro */}
      <div className="mb-6 text-center py-4">
        <MI name="handshake" className="text-[40px] text-slate-400 mb-3" />
        <p className="text-[18px] font-bold text-slate-900 mb-2">Looking to hire from a layoff cohort?</p>
        <p className="text-[14px] text-slate-500 max-w-md mx-auto">
          These are pre-vetted groups of professionals who recently left the same company. Submit
          a request and we&apos;ll surface it to relevant members in the cohort.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto">
        <div>
          <label className="block text-[12px] font-semibold text-slate-600 mb-1">Your company name</label>
          <input
            required
            type="text"
            placeholder="Acme Corp"
            value={form.companyName}
            onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-slate-600 mb-1">Contact email</label>
          <input
            required
            type="email"
            placeholder="hiring@yourcompany.com"
            value={form.contactEmail}
            onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-slate-600 mb-1">Which cohort?</label>
          <select
            value={selectedCohortId}
            onChange={(e) => setSelectedCohortId(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-emerald-400 bg-white"
          >
            <option value="">Select a cohort…</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}{c.department ? ` · ${c.department}` : ""} — {formatDate(c.layoff_date)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-slate-600 mb-1.5">Roles needed</label>
          <div className="flex flex-wrap gap-1.5">
            {ROLE_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => toggleRole(r)}
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-[12px] font-medium border transition-colors",
                  form.rolesNeeded.includes(r)
                    ? "border-sky-400 bg-sky-50 text-sky-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                )}
              >{r}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-slate-600 mb-1">Headcount needed</label>
          <input
            type="number"
            min={1}
            value={form.headcount}
            onChange={(e) => setForm((f) => ({ ...f, headcount: e.target.value }))}
            className="w-32 rounded-lg border border-slate-200 px-3 py-2 text-[14px] outline-none focus:border-emerald-400"
          />
        </div>
        <div>
          <label className="block text-[12px] font-semibold text-slate-600 mb-1">Message (optional)</label>
          <textarea
            placeholder="Tell the cohort about your company and what you're building…"
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-400 resize-none"
          />
        </div>

        {error && <p className="text-[13px] text-red-500">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !form.companyName || !form.contactEmail || form.rolesNeeded.length === 0}
          className={cn(
            "w-full rounded-lg py-2.5 text-[14px] font-semibold text-white transition-colors",
            !submitting && form.companyName && form.contactEmail && form.rolesNeeded.length > 0
              ? "bg-emerald-600 hover:bg-emerald-700"
              : "bg-slate-200 cursor-not-allowed text-slate-400"
          )}
        >
          {submitting ? "Submitting…" : "Submit hiring request →"}
        </button>
      </form>
    </div>
  )
}

// ── Root component ────────────────────────────────────────────────────────────

export default function LayoffCohortHub() {
  const [tab, setTab] = useState<Tab>("cohorts")
  const [cohorts, setCohorts] = useState<CohortListItem[]>([])
  const [cohortsLoading, setCohortsLoading] = useState(true)
  const [cohortsError, setCohortsError] = useState<string | null>(null)

  const [myCohorts, setMyCohorts] = useState<MyCohort[]>([])
  const [myLoading, setMyLoading] = useState(false)

  // Modals
  const [joiningCohort, setJoiningCohort] = useState<CohortListItem | null>(null)
  const [viewingDetail, setViewingDetail] = useState<CohortDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [vouchTarget, setVouchTarget] = useState<{ cohortId: string; userId: string; name: string } | null>(null)

  // Current user id (best-effort from /api/cohorts/my)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  const loadCohorts = useCallback(async () => {
    setCohortsLoading(true)
    setCohortsError(null)
    try {
      const res = await fetch("/api/cohorts")
      if (!res.ok) throw new Error("Failed to load cohorts")
      const data = (await res.json()) as { cohorts: CohortListItem[] }
      setCohorts(data.cohorts)
    } catch {
      setCohortsError("Failed to load cohorts. Please try again.")
    } finally {
      setCohortsLoading(false)
    }
  }, [])

  const loadMyCohorts = useCallback(async () => {
    setMyLoading(true)
    try {
      const res = await fetch("/api/cohorts/my")
      if (res.status === 401) { setMyCohorts([]); return }
      if (!res.ok) throw new Error("Failed")
      const data = (await res.json()) as { cohorts: MyCohort[] }
      setMyCohorts(data.cohorts)
    } catch {
      setMyCohorts([])
    } finally {
      setMyLoading(false)
    }
  }, [])

  useEffect(() => { loadCohorts() }, [loadCohorts])
  // Load myCohorts on mount so the "Join" button can be hidden for already-joined cohorts.
  useEffect(() => { loadMyCohorts() }, [loadMyCohorts])
  useEffect(() => { if (tab === "my") loadMyCohorts() }, [tab, loadMyCohorts])

  async function handleViewDetail(cohortId: string) {
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/cohorts/${cohortId}`)
      if (!res.ok) throw new Error("Failed")
      const data = (await res.json()) as CohortDetail & { currentUserId?: string }
      setViewingDetail(data)
      if (data.currentUserId) setCurrentUserId(data.currentUserId)
    } catch { /* ignore */ }
    finally { setDetailLoading(false) }
  }

  function handleJoinSuccess() {
    setJoiningCohort(null)
    loadCohorts()
    loadMyCohorts()
  }

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "cohorts", label: "Active cohorts", icon: "groups" },
    { id: "my", label: "My cohort", icon: "person" },
    { id: "employers", label: "For employers", icon: "business" },
  ]

  return (
    <>
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />

      <div className="mx-auto max-w-2xl px-4 pb-12 sm:px-6">
        {/* Tab bar */}
        <div className="flex border-b border-[var(--color-border,#E2E8F0)] mb-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-3 text-[14px] font-medium transition-colors border-b-2 -mb-px",
                tab === t.id
                  ? "border-emerald-500 text-emerald-700"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              )}
            >
              <MI name={t.icon} className="text-[16px]" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "cohorts" && (
          <ActiveCohortsTab
            cohorts={cohorts}
            loading={cohortsLoading}
            error={cohortsError}
            joinedCohortIds={new Set(myCohorts.map((mc) => mc.cohortId))}
            onJoin={(id) => {
              const c = cohorts.find((x) => x.id === id)
              if (c) setJoiningCohort(c)
            }}
            onView={handleViewDetail}
          />
        )}

        {tab === "my" && (
          <MyCohortTab
            cohorts={myCohorts}
            loading={myLoading}
            onSwitchToActive={() => setTab("cohorts")}
            onVouch={(cohortId, userId, name) =>
              setVouchTarget({ cohortId, userId, name })
            }
          />
        )}

        {tab === "employers" && <ForEmployersTab cohorts={cohorts} />}
      </div>

      {/* Join modal */}
      {joiningCohort && (
        <JoinModal
          cohort={joiningCohort}
          onClose={() => setJoiningCohort(null)}
          onSuccess={handleJoinSuccess}
        />
      )}

      {/* Detail modal */}
      {detailLoading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="rounded-xl bg-white px-8 py-6 text-[14px] text-slate-600">Loading cohort…</div>
        </div>
      )}
      {viewingDetail && !detailLoading && (
        <CohortDetailModal
          detail={viewingDetail}
          currentUserId={currentUserId}
          onClose={() => setViewingDetail(null)}
          onVouch={(userId, name) =>
            setVouchTarget({ cohortId: viewingDetail.cohort.id, userId, name })
          }
        />
      )}

      {/* Vouch modal */}
      {vouchTarget && (
        <VouchModal
          cohortId={vouchTarget.cohortId}
          voucheeId={vouchTarget.userId}
          voucheeName={vouchTarget.name}
          onClose={() => setVouchTarget(null)}
          onSuccess={() => {
            setVouchTarget(null)
            loadMyCohorts()
          }}
        />
      )}
    </>
  )
}
