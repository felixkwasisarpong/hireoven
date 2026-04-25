"use client"

import { useEffect, useRef } from "react"
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Building2,
  CheckCircle2,
  CircleOff,
  Clock,
  FlaskConical,
  Globe2,
  Link2,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  GHOST_RISK_OPTIONS,
  VISA_FIT_OPTIONS,
} from "@/components/jobs/JobFilters"
import type { GhostRiskMax, JobFilters, VisaFitLabel } from "@/types"

interface Props {
  open: boolean
  onClose: () => void
  filters: JobFilters
  onFiltersChange: (next: JobFilters) => void
  isInternational?: boolean
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-400">
      {children}
    </p>
  )
}

function ToggleRow({
  checked,
  label,
  description,
  icon: Icon,
  iconColor,
  accent,
  onChange,
}: {
  checked: boolean
  label: string
  description?: string
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  accent?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
        checked
          ? accent
            ? "border-indigo-200 bg-indigo-50"
            : "border-orange-200 bg-orange-50"
          : "border-transparent hover:bg-slate-50"
      )}
    >
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
          checked ? iconColor : "bg-slate-100"
        )}
      >
        <Icon className={cn("h-3.5 w-3.5", checked ? "text-white" : "text-slate-500")} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-[13px] font-medium",
            checked
              ? accent ? "text-indigo-900" : "text-orange-900"
              : "text-slate-800"
          )}
        >
          {label}
        </span>
        {description && (
          <span className="block text-[11px] text-slate-500">{description}</span>
        )}
      </span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked
            ? accent ? "bg-indigo-500" : "bg-orange-400"
            : "bg-slate-200"
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition",
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  )
}

function ChipGroup<T extends string>({
  options,
  selected,
  accent,
  onChange,
}: {
  options: { value: T; label: string }[]
  selected: T[]
  accent?: "indigo" | "orange"
  onChange: (next: T[]) => void
}) {
  const col = accent ?? "orange"
  const activeClass =
    col === "indigo"
      ? "border-indigo-300 bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200"
      : "border-orange-300 bg-orange-100 text-orange-900 ring-1 ring-orange-200"

  function toggle(val: T) {
    const next = selected.includes(val)
      ? selected.filter((v) => v !== val)
      : [...selected, val]
    onChange(next)
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = selected.includes(opt.value)
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-[12px] font-medium transition",
              active
                ? activeClass
                : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"
            )}
          >
            {active && <span className="mr-1">✓</span>}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default function AdvancedFiltersDrawer({
  open,
  onClose,
  filters,
  onFiltersChange,
  isInternational = false,
}: Props) {
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open, onClose])

  function set(patch: Partial<JobFilters>) {
    onFiltersChange({ ...filters, ...patch })
  }

  const activeCount = [
    filters.hide_blockers,
    filters.visa_fit?.length,
    filters.stem_opt_ready,
    filters.e_verify_signal,
    filters.cap_exempt_possible,
    filters.lca_salary_aligned,
    filters.ghost_risk_max,
    filters.has_salary,
    filters.direct_ats_only,
    filters.hybrid,
    filters.onsite,
    filters.company_ids?.length,
  ].filter(Boolean).length

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-[9998] bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={drawerRef}
        data-portal-drawer
        className="app-drawer fixed right-0 top-0 z-[9999] flex h-full w-[min(100vw,400px)] flex-col bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Advanced filters"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900">Advanced Filters</h2>
            {activeCount > 0 && (
              <p className="text-xs text-slate-500">
                {activeCount} filter{activeCount !== 1 ? "s" : ""} active
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeCount > 0 && (
              <button
                type="button"
                onClick={() =>
                  set({
                    hide_blockers: undefined,
                    visa_fit: undefined,
                    stem_opt_ready: undefined,
                    e_verify_signal: undefined,
                    cap_exempt_possible: undefined,
                    lca_salary_aligned: undefined,
                    ghost_risk_max: undefined,
                    has_salary: undefined,
                    direct_ats_only: undefined,
                    hybrid: undefined,
                    onsite: undefined,
                    company_ids: undefined,
                  })
                }
                className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-50"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* --- Work mode --- */}
          <div>
            <SectionLabel>Work Mode</SectionLabel>
            <div className="space-y-1.5">
              <ToggleRow
                checked={Boolean(filters.hybrid)}
                label="Hybrid"
                description="Office + remote flexibility"
                icon={Building2}
                iconColor="bg-violet-500"
                onChange={(v) => set({ hybrid: v || undefined })}
              />
              <ToggleRow
                checked={Boolean(filters.onsite)}
                label="On-site only"
                description="In-person roles"
                icon={Globe2}
                iconColor="bg-cyan-500"
                onChange={(v) => set({ onsite: v || undefined })}
              />
            </div>
          </div>

          {/* --- Job quality --- */}
          <div>
            <SectionLabel>Job Quality</SectionLabel>
            <div className="space-y-1.5">
              <ToggleRow
                checked={Boolean(filters.has_salary)}
                label="Salary listed"
                description="Only jobs that disclose pay range"
                icon={Banknote}
                iconColor="bg-emerald-500"
                onChange={(v) => set({ has_salary: v || undefined })}
              />
              <ToggleRow
                checked={Boolean(filters.direct_ats_only)}
                label="Direct ATS link"
                description="Apply directly via Greenhouse, Lever, Workday…"
                icon={Link2}
                iconColor="bg-blue-500"
                onChange={(v) => set({ direct_ats_only: v || undefined })}
              />
            </div>
          </div>

          {/* --- Freshness & Ghost risk --- */}
          <div>
            <SectionLabel>Freshness &amp; Ghost Risk</SectionLabel>
            <div className="space-y-3">
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-slate-600">
                  Max ghost-job risk
                </p>
                <ChipGroup<GhostRiskMax>
                  options={GHOST_RISK_OPTIONS}
                  selected={filters.ghost_risk_max ? [filters.ghost_risk_max] : []}
                  accent="orange"
                  onChange={(vals) =>
                    set({ ghost_risk_max: vals[vals.length - 1] ?? undefined })
                  }
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Filters out stale, evergreen, or suspicious postings.
                </p>
              </div>
            </div>
          </div>

          {/* --- Visa / International --- */}
          {isInternational && (
            <div>
              <SectionLabel>Visa &amp; International</SectionLabel>
              <div className="space-y-1.5 mb-3">
                <ToggleRow
                  checked={Boolean(filters.hide_blockers)}
                  label="Hide sponsorship blockers"
                  description="Remove jobs that explicitly exclude visa candidates"
                  icon={CircleOff}
                  iconColor="bg-rose-500"
                  accent
                  onChange={(v) => set({ hide_blockers: v || undefined })}
                />
                <ToggleRow
                  checked={Boolean(filters.stem_opt_ready)}
                  label="STEM OPT eligible"
                  description="Employers signalling STEM OPT / E-Verify readiness"
                  icon={FlaskConical}
                  iconColor="bg-indigo-500"
                  accent
                  onChange={(v) => set({ stem_opt_ready: v || undefined })}
                />
                <ToggleRow
                  checked={Boolean(filters.e_verify_signal)}
                  label="E-Verify signal"
                  description="Employers that are likely E-Verify enrolled"
                  icon={BadgeCheck}
                  iconColor="bg-indigo-600"
                  accent
                  onChange={(v) => set({ e_verify_signal: v || undefined })}
                />
                <ToggleRow
                  checked={Boolean(filters.cap_exempt_possible)}
                  label="Possible cap-exempt employer"
                  description="Universities, nonprofits, research institutes"
                  icon={ShieldCheck}
                  iconColor="bg-violet-600"
                  accent
                  onChange={(v) => set({ cap_exempt_possible: v || undefined })}
                />
                <ToggleRow
                  checked={Boolean(filters.lca_salary_aligned)}
                  label="LCA salary aligned"
                  description="Listed salary aligns with historical LCA wages"
                  icon={TrendingUp}
                  iconColor="bg-teal-500"
                  accent
                  onChange={(v) => set({ lca_salary_aligned: v || undefined })}
                />
              </div>

              <div>
                <p className="mb-1.5 text-[12px] font-medium text-slate-600">
                  Visa Fit score
                </p>
                <ChipGroup<VisaFitLabel>
                  options={VISA_FIT_OPTIONS}
                  selected={filters.visa_fit ?? []}
                  accent="indigo"
                  onChange={(vals) => set({ visa_fit: vals.length ? vals : undefined })}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Select one or more. Unselected means show all.
                </p>
              </div>
            </div>
          )}

          {/* Show a simplified visa section for non-international users */}
          {!isInternational && (
            <div>
              <SectionLabel>Sponsorship</SectionLabel>
              <div className="space-y-1.5">
                <ToggleRow
                  checked={Boolean(filters.hide_blockers)}
                  label="Hide sponsorship blockers"
                  description="Remove jobs that explicitly exclude visa candidates"
                  icon={CircleOff}
                  iconColor="bg-rose-500"
                  onChange={(v) => set({ hide_blockers: v || undefined })}
                />
              </div>
            </div>
          )}

          {/* Disclaimer */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <p className="text-[11px] leading-snug text-slate-500">
                Intelligence signals are estimates based on available data. Visa
                fit, STEM OPT, and cap-exempt signals are for search guidance
                only. Confirm important immigration decisions with your DSO or attorney.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            {activeCount > 0 ? `Apply ${activeCount} filter${activeCount !== 1 ? "s" : ""}` : "Done"}
          </button>
        </div>
      </div>
    </>
  )
}
