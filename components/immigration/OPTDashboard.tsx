"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Edit2,
  ExternalLink,
  GraduationCap,
  Info,
  MessageSquarePlus,
  Plane,
  Search,
  Shield,
  Users,
} from "lucide-react"
import {
  calculateOptTimelineDashboard,
  createOptTimelineSettingsFromProfile,
} from "@/lib/immigration/opt-timeline"
import { cn } from "@/lib/utils"
import type {
  OptTimelineDashboard,
  OptTimelineEmploymentStatus,
  OptTimelineFallbackCategory,
  OptTimelineImmigrationStatus,
  OptTimelineSettings,
  Profile,
} from "@/types"

// ─── Constants ────────────────────────────────────────────────

const URGENCY: Record<
  OptTimelineDashboard["urgencyLevel"],
  { card: string; badge: string; bar: string; dot: string; text: string }
> = {
  Low:       { card: "border-emerald-200/70 bg-emerald-50/50",  badge: "bg-emerald-100 text-emerald-800",  bar: "bg-gradient-to-r from-emerald-400 to-emerald-500",  dot: "bg-emerald-500",  text: "text-emerald-800" },
  Medium:    { card: "border-amber-200/70 bg-amber-50/50",      badge: "bg-amber-100 text-amber-800",      bar: "bg-gradient-to-r from-amber-400 to-amber-500",      dot: "bg-amber-500",    text: "text-amber-800"   },
  High:      { card: "border-orange-200/70 bg-orange-50/50",    badge: "bg-orange-100 text-orange-800",    bar: "bg-gradient-to-r from-orange-400 to-orange-500",    dot: "bg-orange-500",   text: "text-orange-800"  },
  Emergency: { card: "border-red-200/70 bg-red-50/50",          badge: "bg-red-100 text-red-800",          bar: "bg-gradient-to-r from-red-400 to-red-500",          dot: "bg-red-500",      text: "text-red-800"     },
}

const URGENCY_STRATEGY: Record<OptTimelineDashboard["urgencyLevel"], string[]> = {
  Low:       ["Apply steadily, prioritise quality over speed.", "Build referral relationships now.", "Track employer sponsorship signals."],
  Medium:    ["Maintain a consistent weekly application rhythm.", "Shortlist employers with proven sponsorship.", "Reach out to recruiters proactively."],
  High:      ["Focus only on high-confidence, fast-moving roles.", "Prioritise companies with active LCA history.", "Activate your full referral network."],
  Emergency: ["Target warm referrals and known fast-process employers.", "Review timeline assumptions with your DSO.", "Do not stop applying — any progress matters."],
}

const CATEGORY_META: Record<OptTimelineFallbackCategory, { label: string; icon: React.ElementType; href: string }> = {
  sponsor_friendly_employers:    { label: "Sponsor-friendly employers",    icon: Building2,     href: "/dashboard/international#companies" },
  e_verified_employers:          { label: "E-Verify / STEM OPT employers", icon: Shield,        href: "/dashboard?e_verify=true" },
  contract_or_temp_roles:        { label: "Contract & project roles",      icon: Clock,         href: "/dashboard?employment=contract" },
  university_or_cap_exempt_roles:{ label: "Cap-exempt & university roles", icon: GraduationCap, href: "/dashboard/international?cap_exempt=true" },
  staffing_or_consulting_firms:  { label: "Staffing & consulting firms",   icon: Briefcase,     href: "/dashboard?type=staffing" },
  bridge_education_options:      { label: "Bridge / education options",    icon: BookOpen,      href: "/dashboard/international" },
  non_visa_sensitive_roles:      { label: "All roles (no visa concern)",   icon: Search,        href: "/dashboard" },
  dso_or_immigration_review:     { label: "Consult your DSO / attorney",  icon: Users,         href: "#disclaimer" },
}

const STATUS_LABELS: Record<OptTimelineEmploymentStatus, string> = {
  employed: "Employed", unemployed: "Unemployed",
  offer_accepted: "Offer accepted", not_started: "Not started", unknown: "Not set",
}

const IMMIGRATION_STATUS_LABELS: Record<OptTimelineImmigrationStatus, string> = {
  F1_OPT: "F-1 OPT", F1_STEM_OPT: "F-1 STEM OPT",
  H1B: "H-1B", GC: "Green Card", Citizen: "U.S. Citizen", Other: "Other",
}

const QUICK_ACTIONS = [
  { icon: Plane,            label: "Visa-fit job feed",             href: "/dashboard?sponsorship=true&sort=freshest" },
  { icon: Shield,           label: "E-Verify / STEM OPT employers", href: "/dashboard/international#companies" },
  { icon: GraduationCap,    label: "Cap-exempt jobs",               href: "/dashboard/international?cap_exempt=true" },
  { icon: Search,           label: "Search LCA database",           href: "/dashboard/international/h1b-explorer" },
  { icon: MessageSquarePlus,label: "Recruiter outreach message",    href: "/dashboard/cover-letters" },
]

// ─── Settings form ────────────────────────────────────────────

type SettingsFormState = {
  immigrationStatus: OptTimelineImmigrationStatus
  optStartDate: string
  optEndDate: string
  stemOptStartDate: string
  stemOptEndDate: string
  unemploymentDaysUsed: string
  currentEmploymentStatus: OptTimelineEmploymentStatus
  targetWeeklyApplicationGoal: string
}

function settingsToForm(s: OptTimelineSettings): SettingsFormState {
  return {
    immigrationStatus: s.immigrationStatus,
    optStartDate: s.optStartDate ?? "",
    optEndDate: s.optEndDate ?? "",
    stemOptStartDate: s.stemOptStartDate ?? "",
    stemOptEndDate: s.stemOptEndDate ?? "",
    unemploymentDaysUsed: s.unemploymentDaysUsed != null ? String(s.unemploymentDaysUsed) : "",
    currentEmploymentStatus: s.currentEmploymentStatus,
    targetWeeklyApplicationGoal: s.targetWeeklyApplicationGoal != null ? String(s.targetWeeklyApplicationGoal) : "",
  }
}

function formToSettings(f: SettingsFormState): OptTimelineSettings {
  return {
    immigrationStatus: f.immigrationStatus,
    optStartDate: f.optStartDate || null,
    optEndDate: f.optEndDate || null,
    stemOptStartDate: f.stemOptStartDate || null,
    stemOptEndDate: f.stemOptEndDate || null,
    unemploymentDaysUsed: f.unemploymentDaysUsed ? Number(f.unemploymentDaysUsed) : null,
    currentEmploymentStatus: f.currentEmploymentStatus,
    targetWeeklyApplicationGoal: f.targetWeeklyApplicationGoal ? Number(f.targetWeeklyApplicationGoal) : null,
  }
}

function SettingsForm({ initial, onSave, onCancel }: {
  initial: SettingsFormState
  onSave: (s: OptTimelineSettings) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<SettingsFormState>(initial)
  const isStem = form.immigrationStatus === "F1_STEM_OPT" || (form.immigrationStatus === "Other" && Boolean(form.stemOptStartDate))
  const set = <K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const field = "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/15"
  const label = "mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.15em] text-gray-500"

  return (
    <div className="surface-card rounded-2xl p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Update your OPT timeline</h2>
        <button type="button" onClick={onCancel} className="text-sm text-gray-400 transition hover:text-gray-700">Cancel</button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label}>Immigration status</label>
          <select value={form.immigrationStatus} onChange={(e) => set("immigrationStatus", e.target.value as OptTimelineImmigrationStatus)} className={field}>
            {(Object.entries(IMMIGRATION_STATUS_LABELS) as [OptTimelineImmigrationStatus, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>OPT start date</label>
          <input type="date" value={form.optStartDate} onChange={(e) => set("optStartDate", e.target.value)} className={field} />
        </div>
        <div>
          <label className={label}>OPT end date</label>
          <input type="date" value={form.optEndDate} onChange={(e) => set("optEndDate", e.target.value)} className={field} />
        </div>
        {isStem && (
          <>
            <div>
              <label className={label}>STEM OPT start date</label>
              <input type="date" value={form.stemOptStartDate} onChange={(e) => set("stemOptStartDate", e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>STEM OPT end date</label>
              <input type="date" value={form.stemOptEndDate} onChange={(e) => set("stemOptEndDate", e.target.value)} className={field} />
            </div>
          </>
        )}
        <div>
          <label className={label}>Current employment</label>
          <select value={form.currentEmploymentStatus} onChange={(e) => set("currentEmploymentStatus", e.target.value as OptTimelineEmploymentStatus)} className={field}>
            {(Object.entries(STATUS_LABELS) as [OptTimelineEmploymentStatus, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Unemployment days used</label>
          <input type="number" min={0} max={180} placeholder="e.g. 15" value={form.unemploymentDaysUsed} onChange={(e) => set("unemploymentDaysUsed", e.target.value)} className={field} />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Weekly application target (optional)</label>
          <input type="number" min={1} max={200} placeholder="e.g. 20" value={form.targetWeeklyApplicationGoal} onChange={(e) => set("targetWeeklyApplicationGoal", e.target.value)} className={field} />
          <p className="mt-1.5 text-[11px] text-gray-400">We'll recommend a minimum based on urgency; your goal is the floor.</p>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50">
          Cancel
        </button>
        <button type="button" onClick={() => onSave(formToSettings(form))} className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700">
          Save timeline
        </button>
      </div>
    </div>
  )
}

// ─── Status hero ──────────────────────────────────────────────

function StatusHero({
  data,
  settings,
  onEdit,
}: {
  data: OptTimelineDashboard
  settings: OptTimelineSettings
  onEdit: () => void
}) {
  const u = URGENCY[data.urgencyLevel]
  const daysMax = data.currentAuthorizationPeriod === "STEM_OPT" ? 730 : 365
  const daysPct = data.daysRemaining != null
    ? Math.max(2, Math.min(100, Math.round((data.daysRemaining / daysMax) * 100)))
    : null

  const used = data.unemploymentDaysUsed
  const limit = data.unemploymentDaysLimit
  const uPct = limit != null && used != null
    ? Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
    : null
  const uBarColor = uPct == null ? "bg-gray-300"
    : uPct >= 90 ? "bg-red-500" : uPct >= 66 ? "bg-orange-500"
    : uPct >= 40 ? "bg-amber-500" : "bg-emerald-500"

  return (
    <div className={cn("overflow-hidden rounded-2xl border p-5 sm:p-6", u.card)}>
      {/* Top bar: badges + edit */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider", u.badge)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", u.dot)} />
            {data.urgencyLevel}
          </span>
          <span className="text-xs font-medium text-gray-600">
            {IMMIGRATION_STATUS_LABELS[data.immigrationStatus]}
          </span>
          {settings.currentEmploymentStatus && settings.currentEmploymentStatus !== "unknown" && (
            <span className="text-xs text-gray-400">· {STATUS_LABELS[settings.currentEmploymentStatus]}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 rounded-xl border border-current/15 bg-white/50 px-3 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-white/80"
        >
          <Edit2 className="h-3 w-3" />
          Edit timeline
        </button>
      </div>

      {/* Main stat grid */}
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Days remaining */}
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">
            {data.currentAuthorizationPeriod === "STEM_OPT" ? "STEM OPT" : "OPT"} authorization
          </p>
          {data.daysRemaining != null ? (
            <>
              <p className="text-[3.5rem] font-extrabold leading-none tabular-nums text-gray-950">
                {data.daysRemaining.toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-gray-500">days remaining</p>
              {daysPct != null && (
                <div className="mt-3 space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-black/10">
                    <div className={cn("h-full rounded-full transition-all duration-700", u.bar)} style={{ width: `${daysPct}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-400">{daysPct}% of period remaining</p>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-current/20 bg-white/80 px-4 py-4 text-center">
              <Calendar className="mx-auto mb-1.5 h-5 w-5 text-gray-400" />
              <p className="text-sm font-medium text-gray-600">End date not set</p>
              <p className="mt-0.5 text-[11px] text-gray-400">Add your OPT end date above</p>
            </div>
          )}
        </div>

        {/* Unemployment days */}
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">
            Unemployment days
          </p>
          {limit != null && used != null ? (
            <>
              <div className="flex items-baseline gap-2">
                <p className="text-[3.5rem] font-extrabold leading-none tabular-nums text-gray-950">
                  {used}
                </p>
                <p className="text-xl font-bold text-gray-400">/ {limit}</p>
              </div>
              <p className="mt-1 text-xs text-gray-500">days used of {limit}-day limit</p>
              <div className="mt-3 space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-black/10">
                  <div className={cn("h-full rounded-full transition-all duration-700", uBarColor)} style={{ width: `${uPct ?? 0}%` }} />
                </div>
                <p className="text-[10px] text-gray-400">{uPct ?? 0}% of allowance used</p>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-current/20 bg-white/80 px-4 py-4 text-center">
              <Clock className="mx-auto mb-1.5 h-5 w-5 text-gray-400" />
              <p className="text-sm font-medium text-gray-600">Not tracked</p>
              <p className="mt-0.5 text-[11px] text-gray-400">Add unemployment days in settings</p>
            </div>
          )}
        </div>
      </div>

      {/* Weekly target + strategy */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4 border-t border-current/10 pt-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Weekly target</p>
          <p className="mt-0.5">
            <span className="text-2xl font-extrabold tabular-nums text-gray-950">
              {data.recommendedWeeklyApplicationTarget}
            </span>
            <span className="ml-1.5 text-xs text-gray-500">applications / week</span>
          </p>
        </div>
        <p className="max-w-sm text-right text-xs leading-5 text-gray-500">
          {data.recommendedJobSearchStrategy}
        </p>
      </div>

      {/* Urgency strategies */}
      <div className="mt-4 flex flex-wrap gap-2">
        {URGENCY_STRATEGY[data.urgencyLevel].map((tip) => (
          <span key={tip} className="inline-flex items-center gap-1.5 rounded-full border border-current/15 bg-white/50 px-3 py-1 text-[11px] text-gray-600">
            <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-current opacity-60" />
            {tip}
          </span>
        ))}
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {data.warnings.map((w) => (
            <div key={w} className="flex items-start gap-2 rounded-xl bg-amber-50/90 px-3 py-2.5 ring-1 ring-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
              <p className="text-[11.5px] text-amber-800">{w}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Priority list ────────────────────────────────────────────

function PriorityList({ data }: { data: OptTimelineDashboard }) {
  return (
    <div className="surface-card overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
          Priority job categories
        </p>
        <p className="mt-0.5 text-xs text-gray-500">Ranked for your current situation</p>
      </div>
      <div className="divide-y divide-gray-50">
        {data.recommendedFallbackCategories.map((cat, i) => {
          const meta = CATEGORY_META[cat]
          if (!meta) return null
          const Icon = meta.icon
          return (
            <Link
              key={cat}
              href={meta.href}
              className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-indigo-50/30"
            >
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 transition group-hover:bg-indigo-100 group-hover:text-indigo-600">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="flex-1 text-sm text-gray-700 transition group-hover:text-indigo-700">
                {meta.label}
              </span>
              {i === 0 && (
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                  Top pick
                </span>
              )}
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-300 transition group-hover:text-indigo-400" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ─── Quick actions list ───────────────────────────────────────

function ActionList() {
  return (
    <div className="surface-card overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-3.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Quick actions</p>
      </div>
      <div className="divide-y divide-gray-50">
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon
          return (
            <Link
              key={a.href}
              href={a.href}
              className="group flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50/70"
            >
              <Icon className="h-4 w-4 flex-shrink-0 text-gray-400 transition group-hover:text-indigo-500" />
              <span className="flex-1 text-sm text-gray-700 transition group-hover:text-indigo-700">
                {a.label}
              </span>
              <ExternalLink className="h-3.5 w-3.5 flex-shrink-0 text-gray-300 group-hover:text-indigo-400" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

// ─── Assumptions ─────────────────────────────────────────────

function AssumptionsSection({ data }: { data: OptTimelineDashboard }) {
  const [open, setOpen] = useState(false)
  const total = data.assumptions.length + data.dataGaps.length
  if (!total && !data.warnings.length) return null

  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/40 px-5 py-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-gray-400" />
          <span className="text-xs font-medium text-gray-500">
            {total} planning note{total !== 1 ? "s" : ""}
          </span>
        </div>
        {open
          ? <ChevronUp className="h-3.5 w-3.5 text-gray-400" />
          : <ChevronDown className="h-3.5 w-3.5 text-gray-400" />}
      </button>

      {open && (
        <div className="mt-3 space-y-1.5">
          {data.dataGaps.map((g) => (
            <div key={g} className="flex gap-2 text-[11.5px] text-gray-500">
              <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {g}
            </div>
          ))}
          {data.assumptions.map((a) => (
            <div key={a} className="flex gap-2 text-[11.5px] text-gray-500">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {a}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Disclaimer ───────────────────────────────────────────────

function Disclaimer() {
  return (
    <div id="disclaimer" className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50/40 px-5 py-4">
      <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
      <p className="text-[11.5px] leading-relaxed text-gray-500">
        <strong className="font-semibold text-gray-700">Planning tool only.</strong>{" "}
        Unemployment day counts, authorization periods, and cap calculations vary by circumstance.
        Confirm all dates with your DSO or a licensed immigration attorney before taking action.
      </p>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────

export default function OPTDashboard({ profile }: { profile: Profile | null }) {
  const [isEditing, setIsEditing] = useState(false)
  const [overrideSettings, setOverrideSettings] = useState<OptTimelineSettings | null>(null)

  const baseSettings = useMemo(() => {
    if (!profile) return null
    return createOptTimelineSettingsFromProfile({
      is_international: profile.is_international,
      visa_status: profile.visa_status,
      opt_end_date: profile.opt_end_date,
      opt_timeline_settings: profile.opt_timeline_settings ?? null,
    })
  }, [profile])

  const activeSettings = overrideSettings ?? baseSettings

  const dashboard = useMemo(() => {
    if (!activeSettings) return null
    return calculateOptTimelineDashboard(activeSettings)
  }, [activeSettings])

  const handleSave = useCallback((settings: OptTimelineSettings) => {
    setOverrideSettings(settings)
    setIsEditing(false)
  }, [])

  if (!profile) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
        <p className="text-sm text-gray-400">Sign in to view your OPT timeline.</p>
      </div>
    )
  }

  const isNotTracked =
    !activeSettings ||
    (activeSettings.immigrationStatus !== "F1_OPT" &&
      activeSettings.immigrationStatus !== "F1_STEM_OPT" &&
      activeSettings.immigrationStatus !== "Other")

  return (
    <div className="space-y-5">
      {/* Setup CTA */}
      {!isEditing && !dashboard?.daysRemaining && !isNotTracked && (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-800">Set up your OPT timeline</p>
            <p className="mt-0.5 text-xs text-gray-500">Add your OPT end date to unlock the full dashboard.</p>
          </div>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="flex-shrink-0 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            Add dates
          </button>
        </div>
      )}

      {/* Not OPT message */}
      {isNotTracked && !isEditing && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-8 text-center">
          <Plane className="mx-auto mb-2 h-7 w-7 text-gray-300" />
          <p className="text-sm font-medium text-gray-700">OPT tracking is for F-1 students</p>
          <p className="mt-1 text-xs text-gray-400">
            Update your immigration status to F-1 OPT or STEM OPT to see your timeline.
          </p>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="mt-3 text-sm font-semibold text-indigo-600 transition hover:text-indigo-800"
          >
            Update status →
          </button>
        </div>
      )}

      {/* Settings form */}
      {isEditing && activeSettings && (
        <SettingsForm
          initial={settingsToForm(activeSettings)}
          onSave={handleSave}
          onCancel={() => setIsEditing(false)}
        />
      )}

      {/* Main dashboard */}
      {dashboard && !isEditing && (
        <>
          <StatusHero data={dashboard} settings={activeSettings!} onEdit={() => setIsEditing(true)} />

          <div className="grid gap-5 xl:grid-cols-[1fr_280px]">
            <PriorityList data={dashboard} />
            <ActionList />
          </div>

          <AssumptionsSection data={dashboard} />
        </>
      )}

      <Disclaimer />
    </div>
  )
}
