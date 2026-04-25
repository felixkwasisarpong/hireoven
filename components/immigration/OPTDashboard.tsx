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
  Target,
  TrendingUp,
  Users,
  Zap,
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

// ─────────────────────────────────────────────────────────────
// Design primitives
// ─────────────────────────────────────────────────────────────

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("surface-card rounded-2xl p-5 sm:p-6", className)}>
      {children}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="section-kicker mb-3">{children}</p>
  )
}

function CardTitle({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--accent))]" aria-hidden />
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {children}
      </h2>
    </div>
  )
}

const URGENCY_STYLES: Record<
  OptTimelineDashboard["urgencyLevel"],
  { card: string; badge: string; bar: string; dot: string; label: string }
> = {
  Low:       { card: "border-emerald-200/60 bg-emerald-50/40",  badge: "bg-emerald-100 text-emerald-800",  bar: "bg-gradient-to-r from-emerald-400 to-emerald-500",  dot: "bg-emerald-400",  label: "Low — you have time" },
  Medium:    { card: "border-amber-200/60  bg-amber-50/40",     badge: "bg-amber-100   text-amber-800",    bar: "bg-gradient-to-r from-amber-400   to-amber-500",    dot: "bg-amber-400",    label: "Medium — keep momentum" },
  High:      { card: "border-orange-200/60 bg-orange-50/40",   badge: "bg-orange-100  text-orange-800",   bar: "bg-gradient-to-r from-orange-400  to-orange-500",   dot: "bg-orange-400",   label: "High — prioritise now" },
  Emergency: { card: "border-red-200/60    bg-red-50/40",       badge: "bg-red-100     text-red-800",      bar: "bg-gradient-to-r from-red-400     to-red-500",      dot: "bg-red-400",      label: "Emergency — act immediately" },
}

const CATEGORY_META: Record<
  OptTimelineFallbackCategory,
  { label: string; icon: React.ElementType; href: string }
> = {
  sponsor_friendly_employers:    { label: "Sponsor-friendly employers",   icon: Building2,       href: "/dashboard/international#companies" },
  e_verified_employers:          { label: "E-Verify / STEM OPT employers",icon: Shield,          href: "/dashboard?e_verify=true" },
  contract_or_temp_roles:        { label: "Contract & project roles",     icon: Clock,           href: "/dashboard?employment=contract" },
  university_or_cap_exempt_roles:{ label: "Cap-exempt & university roles",icon: GraduationCap,   href: "/dashboard/international?cap_exempt=true" },
  staffing_or_consulting_firms:  { label: "Staffing & consulting firms",  icon: Briefcase,       href: "/dashboard?type=staffing" },
  bridge_education_options:      { label: "Bridge / education options",   icon: BookOpen,        href: "/dashboard/international" },
  non_visa_sensitive_roles:      { label: "All roles (no visa concern)",  icon: Search,          href: "/dashboard" },
  dso_or_immigration_review:     { label: "Consult your DSO / attorney",  icon: Users,           href: "#disclaimer" },
}

const STATUS_LABELS: Record<OptTimelineEmploymentStatus, string> = {
  employed:       "Employed",
  unemployed:     "Unemployed",
  offer_accepted: "Offer accepted",
  not_started:    "Not started",
  unknown:        "Not set",
}

const IMMIGRATION_STATUS_LABELS: Record<OptTimelineImmigrationStatus, string> = {
  F1_OPT:      "F-1 OPT",
  F1_STEM_OPT: "F-1 STEM OPT",
  H1B:         "H-1B",
  GC:          "Green Card",
  Citizen:     "U.S. Citizen",
  Other:       "Other",
}

// ─────────────────────────────────────────────────────────────
// Settings form
// ─────────────────────────────────────────────────────────────

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
    targetWeeklyApplicationGoal:
      s.targetWeeklyApplicationGoal != null ? String(s.targetWeeklyApplicationGoal) : "",
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
    targetWeeklyApplicationGoal: f.targetWeeklyApplicationGoal
      ? Number(f.targetWeeklyApplicationGoal)
      : null,
  }
}

type SettingsFormProps = {
  initial: SettingsFormState
  onSave: (settings: OptTimelineSettings) => void
  onCancel: () => void
}

function SettingsForm({ initial, onSave, onCancel }: SettingsFormProps) {
  const [form, setForm] = useState<SettingsFormState>(initial)
  const isStem =
    form.immigrationStatus === "F1_STEM_OPT" ||
    (form.immigrationStatus === "Other" && Boolean(form.stemOptStartDate))

  const set = <K extends keyof SettingsFormState>(key: K, value: SettingsFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const inputCls =
    "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-strong outline-none transition placeholder:text-muted-foreground/60 focus:border-[hsl(var(--accent))] focus:ring-2 focus:ring-[hsl(var(--accent))]/20"
  const labelCls = "mb-1 block text-[11.5px] font-semibold text-muted-foreground uppercase tracking-wide"

  return (
    <div className="surface-card rounded-2xl p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-strong">Update your OPT timeline</h2>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-surface-muted"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Immigration status */}
        <div className="sm:col-span-2">
          <label className={labelCls}>Immigration status</label>
          <select
            value={form.immigrationStatus}
            onChange={(e) => set("immigrationStatus", e.target.value as OptTimelineImmigrationStatus)}
            className={inputCls}
          >
            {(Object.entries(IMMIGRATION_STATUS_LABELS) as [OptTimelineImmigrationStatus, string][]).map(
              ([k, v]) => <option key={k} value={k}>{v}</option>
            )}
          </select>
        </div>

        {/* OPT dates */}
        <div>
          <label className={labelCls}>OPT start date</label>
          <input type="date" value={form.optStartDate} onChange={(e) => set("optStartDate", e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>OPT end date</label>
          <input type="date" value={form.optEndDate} onChange={(e) => set("optEndDate", e.target.value)} className={inputCls} />
        </div>

        {/* STEM OPT dates */}
        {(isStem || form.immigrationStatus === "F1_STEM_OPT") && (
          <>
            <div>
              <label className={labelCls}>STEM OPT start date</label>
              <input type="date" value={form.stemOptStartDate} onChange={(e) => set("stemOptStartDate", e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>STEM OPT end date</label>
              <input type="date" value={form.stemOptEndDate} onChange={(e) => set("stemOptEndDate", e.target.value)} className={inputCls} />
            </div>
          </>
        )}

        {/* Employment status */}
        <div>
          <label className={labelCls}>Current employment</label>
          <select
            value={form.currentEmploymentStatus}
            onChange={(e) => set("currentEmploymentStatus", e.target.value as OptTimelineEmploymentStatus)}
            className={inputCls}
          >
            {(Object.entries(STATUS_LABELS) as [OptTimelineEmploymentStatus, string][]).map(
              ([k, v]) => <option key={k} value={k}>{v}</option>
            )}
          </select>
        </div>

        {/* Unemployment days */}
        <div>
          <label className={labelCls}>Unemployment days used</label>
          <input
            type="number"
            min={0}
            max={180}
            placeholder="e.g. 15"
            value={form.unemploymentDaysUsed}
            onChange={(e) => set("unemploymentDaysUsed", e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Weekly goal */}
        <div className="sm:col-span-2">
          <label className={labelCls}>Weekly application target (optional)</label>
          <input
            type="number"
            min={1}
            max={200}
            placeholder="e.g. 20"
            value={form.targetWeeklyApplicationGoal}
            onChange={(e) => set("targetWeeklyApplicationGoal", e.target.value)}
            className={inputCls}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            We'll recommend a minimum based on urgency; your goal is the floor.
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-border px-4 py-2 text-[13px] font-medium text-strong hover:bg-surface-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(formToSettings(form))}
          className="rounded-xl bg-[hsl(var(--accent))] px-5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          Save timeline
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Dashboard sections
// ─────────────────────────────────────────────────────────────

function AuthorizationTimelineCard({ data }: { data: OptTimelineDashboard }) {
  const u = URGENCY_STYLES[data.urgencyLevel]
  const daysMax = data.currentAuthorizationPeriod === "STEM_OPT" ? 730 : 365
  const daysPct =
    data.daysRemaining != null
      ? Math.max(2, Math.min(100, Math.round((data.daysRemaining / daysMax) * 100)))
      : null

  const authLabel =
    data.currentAuthorizationPeriod === "STEM_OPT"
      ? "STEM OPT"
      : data.currentAuthorizationPeriod === "OPT"
      ? "OPT"
      : null

  return (
    <Card>
      <CardTitle icon={Calendar}>Authorization timeline</CardTitle>
      {data.daysRemaining == null ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-alt px-5 py-6 text-center">
          <Calendar className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-strong">End date not set</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Add your OPT or STEM OPT end date to see your timeline.
          </p>
        </div>
      ) : (
        <div className={cn("rounded-xl border p-4", u.card)}>
          <div className="mb-3 flex items-end justify-between gap-2">
            <div>
              {authLabel && (
                <span className="mb-1 inline-block rounded-full border border-current/20 bg-white/60 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-inherit">
                  {authLabel}
                </span>
              )}
              <p className="mt-1 text-5xl font-extrabold tabular-nums text-strong">
                {data.daysRemaining.toLocaleString()}
              </p>
              <p className="text-[12px] text-muted-foreground">days remaining in current authorization</p>
            </div>
            <span className={cn("rounded-full px-3 py-1 text-[11px] font-semibold", u.badge)}>
              {data.urgencyLevel}
            </span>
          </div>

          {daysPct != null && (
            <div className="mt-1">
              <div className="h-2.5 overflow-hidden rounded-full bg-white/60">
                <div
                  className={cn("h-full rounded-full transition-all duration-700", u.bar)}
                  style={{ width: `${daysPct}%` }}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Roughly {daysPct}% of authorization period remaining
              </p>
            </div>
          )}
        </div>
      )}

      {data.dataGaps.length > 0 && (
        <ul className="mt-3 space-y-1">
          {data.dataGaps.map((gap) => (
            <li key={gap} className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {gap}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function UnemploymentTrackerCard({ data }: { data: OptTimelineDashboard }) {
  const limit = data.unemploymentDaysLimit
  const used = data.unemploymentDaysUsed
  const remaining = data.estimatedUnemploymentDaysRemaining

  const pct =
    limit != null && used != null
      ? Math.max(0, Math.min(100, Math.round((used / limit) * 100)))
      : null

  const barColor =
    pct == null
      ? "bg-slate-300"
      : pct >= 90
      ? "bg-gradient-to-r from-red-400 to-red-500"
      : pct >= 66
      ? "bg-gradient-to-r from-orange-400 to-orange-500"
      : pct >= 40
      ? "bg-gradient-to-r from-amber-400 to-amber-500"
      : "bg-gradient-to-r from-emerald-400 to-emerald-500"

  const isTracked = data.currentAuthorizationPeriod === "OPT" || data.currentAuthorizationPeriod === "STEM_OPT"

  return (
    <Card>
      <CardTitle icon={Clock}>Unemployment days</CardTitle>

      {!isTracked ? (
        <p className="text-sm text-muted-foreground">
          Unemployment day tracking applies to OPT and STEM OPT. Set your status above to enable this section.
        </p>
      ) : limit == null || used == null ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-alt px-5 py-5 text-center">
          <p className="text-sm font-medium text-strong">Days not recorded</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Enter unemployment days used in your settings to track your remaining allowance.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Used",      value: used,      accent: false },
              { label: "Remaining", value: remaining ?? "—", accent: true },
              { label: "Limit",     value: limit,     accent: false },
            ].map(({ label, value, accent }) => (
              <div
                key={label}
                className={cn(
                  "rounded-xl p-3 text-center",
                  accent
                    ? "bg-[hsl(var(--accent))]/8 ring-1 ring-[hsl(var(--accent))]/20"
                    : "bg-surface-alt"
                )}
              >
                <p className={cn("text-2xl font-bold tabular-nums", accent ? "text-[hsl(var(--accent))]" : "text-strong")}>
                  {typeof value === "number" ? value.toLocaleString() : value}
                </p>
                <p className="mt-0.5 text-[10.5px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
              <span>0 days</span>
              <span>{limit} day limit</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-surface-muted">
              <div
                className={cn("h-full rounded-full transition-all duration-700", barColor)}
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {pct != null ? `${pct}% of allowance used` : ""}
            </p>
          </div>

          {data.warnings
            .filter((w) => w.toLowerCase().includes("unemploy"))
            .map((w) => (
              <div key={w} className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 ring-1 ring-amber-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden />
                <p className="text-[11.5px] text-amber-800">{w}</p>
              </div>
            ))}
        </>
      )}
    </Card>
  )
}

function UrgencyCard({ data }: { data: OptTimelineDashboard }) {
  const u = URGENCY_STYLES[data.urgencyLevel]
  const strategies: Record<OptTimelineDashboard["urgencyLevel"], string[]> = {
    Low:       ["Apply steadily, prioritise quality over speed.", "Build referral relationships now.", "Track employer sponsorship signals."],
    Medium:    ["Maintain a consistent weekly application rhythm.", "Shortlist employers with proven sponsorship.", "Reach out to recruiters proactively."],
    High:      ["Focus only on high-confidence, fast-moving roles.", "Prioritise companies with active LCA history.", "Activate your full referral network."],
    Emergency: ["Target warm referrals and known fast-process employers.", "Review timeline assumptions with your DSO.", "Do not stop applying — any progress matters."],
  }

  return (
    <Card className={cn("border", u.card)}>
      <CardTitle icon={Zap}>Urgency level</CardTitle>
      <div className="mb-4 flex items-center gap-3">
        <span className={cn("h-3 w-3 rounded-full", u.dot)} />
        <span className={cn("text-[15px] font-semibold", u.badge.replace("bg-", "text-").replace("text-", "text-")
          .replace(/bg-\w+-100\s/, ""))}>
          {u.label}
        </span>
      </div>
      <ul className="space-y-2">
        {strategies[data.urgencyLevel].map((s) => (
          <li key={s} className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent))]" aria-hidden />
            {s}
          </li>
        ))}
      </ul>

      {data.urgencyLevel === "Emergency" && data.warnings.some((w) => w.includes("Timeline appears")) && (
        <div className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 ring-1 ring-red-200">
          <p className="text-[11.5px] font-medium text-red-800">
            This is a planning estimate. Verify your timeline with your DSO before making decisions.
          </p>
        </div>
      )}
    </Card>
  )
}

function WeeklyTargetCard({ data }: { data: OptTimelineDashboard }) {
  const u = URGENCY_STYLES[data.urgencyLevel]
  return (
    <Card>
      <CardTitle icon={Target}>Weekly application target</CardTitle>
      <div className="mb-3 flex items-end gap-3">
        <span className="text-5xl font-extrabold tabular-nums text-strong">
          {data.recommendedWeeklyApplicationTarget}
        </span>
        <span className="mb-1.5 text-[12px] text-muted-foreground">applications / week</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
        <div
          className={cn("h-full rounded-full", u.bar)}
          style={{
            width: `${Math.min(100, Math.round((data.recommendedWeeklyApplicationTarget / 80) * 100))}%`,
          }}
        />
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        {data.recommendedJobSearchStrategy}
      </p>
    </Card>
  )
}

function PriorityJobCategoriesCard({ data }: { data: OptTimelineDashboard }) {
  return (
    <Card>
      <CardTitle icon={TrendingUp}>Priority categories</CardTitle>
      <div className="space-y-2">
        {data.recommendedFallbackCategories.map((cat, i) => {
          const meta = CATEGORY_META[cat]
          if (!meta) return null
          const Icon = meta.icon
          return (
            <Link
              key={cat}
              href={meta.href}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-[13px] font-medium text-strong transition hover:border-[hsl(var(--accent-soft-border))] hover:bg-[hsl(var(--accent))]/6 hover:text-[hsl(var(--accent))] group"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-alt text-muted-foreground group-hover:bg-[hsl(var(--accent))]/10 group-hover:text-[hsl(var(--accent))] transition">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="truncate">{meta.label}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {i === 0 && (
                  <span className="rounded-full bg-[hsl(var(--accent))]/10 px-2 py-0.5 text-[10px] font-semibold text-[hsl(var(--accent))]">
                    Top pick
                  </span>
                )}
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50" aria-hidden />
              </div>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}

function QuickActionsCard() {
  const actions = [
    {
      icon: Plane,
      label: "Find strong visa-fit jobs",
      description: "Filtered feed: sponsors with LCA history",
      href: "/dashboard?sponsorship=true&sort=freshest",
    },
    {
      icon: Shield,
      label: "E-Verify / STEM OPT employers",
      description: "Companies more likely to use E-Verify",
      href: "/dashboard/international#companies",
    },
    {
      icon: GraduationCap,
      label: "Cap-exempt jobs",
      description: "Universities, nonprofits, and research orgs",
      href: "/dashboard/international?cap_exempt=true",
    },
    {
      icon: Search,
      label: "Search the LCA database",
      description: "See real DOL petition data by employer",
      href: "/dashboard/international/h1b-explorer",
    },
    {
      icon: MessageSquarePlus,
      label: "Generate recruiter sponsorship message",
      description: "Use the cover letter tool to craft your outreach",
      href: "/dashboard/cover-letters",
    },
  ]

  return (
    <Card>
      <CardTitle icon={Zap}>Quick actions</CardTitle>
      <div className="space-y-2">
        {actions.map((a) => {
          const Icon = a.icon
          return (
            <Link
              key={a.href}
              href={a.href}
              className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:border-[hsl(var(--accent-soft-border))] hover:bg-[hsl(var(--accent))]/6 group"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-alt text-muted-foreground group-hover:bg-[hsl(var(--accent))]/10 group-hover:text-[hsl(var(--accent))] transition">
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-strong group-hover:text-[hsl(var(--accent))] transition">
                  {a.label}
                </p>
                <p className="text-[11.5px] text-muted-foreground">{a.description}</p>
              </div>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}

function AssumptionsCard({ data }: { data: OptTimelineDashboard }) {
  const [open, setOpen] = useState(false)
  if (!data.assumptions.length && !data.dataGaps.length && !data.warnings.length) return null
  const total = data.assumptions.length + data.dataGaps.length + data.warnings.length

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-[13px] font-medium text-muted-foreground">
            {total} planning note{total !== 1 ? "s" : ""}
          </span>
        </div>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="mt-4 space-y-2">
          {data.warnings.map((w) => (
            <div key={w} className="flex gap-2 text-[12px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {w}
            </div>
          ))}
          {data.dataGaps.map((g) => (
            <div key={g} className="flex gap-2 text-[12px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {g}
            </div>
          ))}
          {data.assumptions.map((a) => (
            <div key={a} className="flex gap-2 text-[12px] text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {a}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Disclaimer() {
  return (
    <div id="disclaimer" className="rounded-2xl border border-border/50 bg-surface-alt px-5 py-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-strong">Planning tool only.</strong>{" "}
          Use this dashboard to organise your job search, not to make immigration decisions. Unemployment
          day counts, authorization periods, and cap calculations vary by circumstance. Confirm all dates
          and calculations with your Designated School Official (DSO) or a licensed immigration attorney
          before taking action.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Root export
// ─────────────────────────────────────────────────────────────

type OPTDashboardProps = {
  profile: Profile | null
}

export default function OPTDashboard({ profile }: OPTDashboardProps) {
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
      <div className="rounded-2xl border border-dashed border-border bg-surface-alt p-10 text-center">
        <p className="text-sm text-muted-foreground">Sign in to view your OPT timeline.</p>
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
      {/* Setup CTA when dates are entirely missing */}
      {!isEditing && !dashboard?.daysRemaining && !isNotTracked && (
        <div className="rounded-2xl border border-dashed border-[hsl(var(--accent))]/40 bg-[hsl(var(--accent))]/5 px-5 py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[13px] font-semibold text-strong">Set up your OPT timeline</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Add your OPT end date to unlock the full dashboard. Takes under a minute.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="shrink-0 rounded-xl bg-[hsl(var(--accent))] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              Add dates
            </button>
          </div>
        </div>
      )}

      {/* Not-OPT message */}
      {isNotTracked && !isEditing && (
        <div className="rounded-2xl border border-border bg-surface-alt px-5 py-6 text-center">
          <Plane className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
          <p className="text-[13px] font-medium text-strong">OPT tracking is for F-1 students</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Update your immigration status to F-1 OPT or STEM OPT to see your timeline.
          </p>
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="mt-3 text-[12px] font-semibold text-[hsl(var(--accent))] hover:underline"
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
          {/* Edit bar */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  URGENCY_STYLES[dashboard.urgencyLevel].badge
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", URGENCY_STYLES[dashboard.urgencyLevel].dot)} />
                {IMMIGRATION_STATUS_LABELS[dashboard.immigrationStatus]}
              </span>
              {activeSettings?.currentEmploymentStatus && (
                <span className="text-muted-foreground">
                  · {STATUS_LABELS[activeSettings.currentEmploymentStatus]}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-surface-muted hover:text-strong"
            >
              <Edit2 className="h-3.5 w-3.5" aria-hidden />
              Edit timeline
            </button>
          </div>

          {/* Grid layout */}
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            {/* Main column */}
            <div className="space-y-5">
              <AuthorizationTimelineCard data={dashboard} />
              <UnemploymentTrackerCard data={dashboard} />
              <PriorityJobCategoriesCard data={dashboard} />
              <AssumptionsCard data={dashboard} />
            </div>

            {/* Sidebar */}
            <div className="space-y-5 xl:sticky xl:top-6 xl:self-start">
              <UrgencyCard data={dashboard} />
              <WeeklyTargetCard data={dashboard} />
              <QuickActionsCard />
            </div>
          </div>
        </>
      )}

      <Disclaimer />
    </div>
  )
}
