"use client"

import { useMemo, type ComponentType } from "react"
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation"
import { cn } from "@/lib/utils"
import type {
  EmploymentType,
  GhostRiskMax,
  JobFilters,
  JobSortOption,
  JobWithinWindow,
  SeniorityLevel,
  VisaFitLabel,
} from "@/types"

export const SENIORITY_OPTIONS: {
  value: SeniorityLevel
  label: string
}[] = [
  { value: "intern", label: "Intern" },
  { value: "junior", label: "Junior" },
  { value: "mid", label: "Mid" },
  { value: "senior", label: "Senior" },
  { value: "staff", label: "Staff+" },
]

export const EMPLOYMENT_OPTIONS: {
  value: EmploymentType
  label: string
}[] = [
  { value: "fulltime", label: "Full-time" },
  { value: "parttime", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
]

export const WITHIN_OPTIONS: {
  value: JobWithinWindow
  label: string
}[] = [
  { value: "all", label: "Any time" },
  { value: "1h", label: "Last hour" },
  { value: "6h", label: "Last 6 hours" },
  { value: "24h", label: "Last 24 hours" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last 7 days" },
]

export const VISA_FIT_OPTIONS: { value: VisaFitLabel; label: string }[] = [
  { value: "Very Strong", label: "Very Strong" },
  { value: "Strong", label: "Strong" },
  { value: "Medium", label: "Medium" },
  { value: "Weak", label: "Weak" },
  { value: "Blocked", label: "Blocked" },
]

export const GHOST_RISK_OPTIONS: { value: GhostRiskMax; label: string }[] = [
  { value: "low", label: "Low risk only" },
  { value: "medium", label: "Low + Medium risk" },
]

export const SORT_OPTIONS: {
  value: JobSortOption
  label: string
}[] = [
  { value: "freshest", label: "Freshest first" },
  { value: "match", label: "Best match" },
  { value: "relevant", label: "Most relevant" },
]

export type FilterPillTone =
  | "sponsorship"
  | "location"
  | "employment"
  | "posted"
  | "remote"
  | "skills"
  | "industry"
  | "visa"
  | "quality"
  | "default"

export type FilterPill = {
  id: string
  label: string
  nextFilters: JobFilters
  tone: FilterPillTone
}

/** Full filter reset for “clear all” (booleans explicit; sort preserved by caller if desired). */
export function clearedJobFilters(): JobFilters {
  return {
    remote: false,
    hybrid: false,
    onsite: false,
    sponsorship: false,
    seniority: undefined,
    employment_type: undefined,
    within: "all",
    company_ids: undefined,
    sort: undefined,
    locationQuery: undefined,
    min_salary: undefined,
    skills: undefined,
    industryQuery: undefined,
    // Advanced filters
    hide_blockers: undefined,
    visa_fit: undefined,
    stem_opt_ready: undefined,
    e_verify_signal: undefined,
    cap_exempt_possible: undefined,
    lca_salary_aligned: undefined,
    ghost_risk_max: undefined,
    has_salary: undefined,
    direct_ats_only: undefined,
  }
}

export function pillToneClasses(tone: FilterPillTone): string {
  switch (tone) {
    case "sponsorship":
      return "border-emerald-200/90 bg-emerald-50 text-emerald-900 hover:bg-emerald-100/90"
    case "location":
      return "border-sky-200/90 bg-sky-50 text-[#0052CC] hover:bg-sky-100/80"
    case "employment":
      return "border-violet-200/90 bg-violet-50 text-violet-900 hover:bg-violet-100/80"
    case "posted":
      return "border-slate-200/90 bg-slate-50 text-slate-800 hover:bg-slate-100/90"
    case "remote":
      return "border-cyan-200/90 bg-cyan-50 text-cyan-900 hover:bg-cyan-100/80"
    case "skills":
      return "border-amber-200/90 bg-amber-50 text-amber-950 hover:bg-amber-100/80"
    case "industry":
      return "border-teal-200/90 bg-teal-50 text-teal-900 hover:bg-teal-100/80"
    case "visa":
      return "border-indigo-200/90 bg-indigo-50 text-indigo-900 hover:bg-indigo-100/80"
    case "quality":
      return "border-orange-200/90 bg-orange-50 text-orange-900 hover:bg-orange-100/80"
    default:
      return "border-slate-200/90 bg-slate-50 text-slate-800 hover:bg-slate-100/90"
  }
}

function parseList<T extends string>(
  params: URLSearchParams | ReadonlyURLSearchParams,
  key: string
) {
  return params
    .get(key)
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) as T[] | undefined
}

function normalizeArray<T extends string>(values?: T[]) {
  if (!values?.length) return undefined
  return Array.from(new Set(values))
}

export function parseJobFilters(
  params: URLSearchParams | ReadonlyURLSearchParams
): JobFilters {
  const within = (params.get("within") as JobWithinWindow | null) ?? "all"
  const sortParam = params.get("sort") as JobSortOption | null
  const sort = sortParam && ["freshest", "match", "relevant"].includes(sortParam)
    ? (sortParam as JobSortOption)
    : undefined

  const minSalaryRaw = params.get("min_salary")
  const minSalaryNum = minSalaryRaw ? Number(minSalaryRaw) : NaN
  const min_salary = Number.isFinite(minSalaryNum) && minSalaryNum > 0
    ? Math.floor(minSalaryNum)
    : undefined

  const skillsRaw = parseList<string>(params, "skills")
  const skills =
    skillsRaw?.map((s) => s.trim()).filter(Boolean).length ? skillsRaw.map((s) => s.trim()) : undefined

  const ghostRiskRaw = params.get("ghost_risk_max")
  const ghost_risk_max =
    ghostRiskRaw === "low" || ghostRiskRaw === "medium"
      ? (ghostRiskRaw as GhostRiskMax)
      : undefined

  const visaFitRaw = parseList<VisaFitLabel>(params, "visa_fit")

  return {
    remote: params.get("remote") === "true",
    hybrid: params.get("hybrid") === "true",
    onsite: params.get("onsite") === "true",
    sponsorship: params.get("sponsorship") === "true",
    seniority: parseList<SeniorityLevel>(params, "seniority"),
    employment_type: parseList<EmploymentType>(params, "employment"),
    within,
    company_ids: parseList<string>(params, "companies"),
    sort,
    locationQuery: params.get("location")?.trim() || undefined,
    min_salary,
    skills,
    industryQuery: params.get("industry")?.trim() || undefined,
    // Advanced filters
    hide_blockers: params.get("hide_blockers") === "true" || undefined,
    visa_fit: visaFitRaw?.length ? visaFitRaw : undefined,
    stem_opt_ready: params.get("stem_opt_ready") === "true" || undefined,
    e_verify_signal: params.get("e_verify_signal") === "true" || undefined,
    cap_exempt_possible: params.get("cap_exempt_possible") === "true" || undefined,
    lca_salary_aligned: params.get("lca_salary_aligned") === "true" || undefined,
    ghost_risk_max,
    has_salary: params.get("has_salary") === "true" || undefined,
    direct_ats_only: params.get("direct_ats_only") === "true" || undefined,
  }
}

export function filtersToSearchParams(
  current: URLSearchParams | ReadonlyURLSearchParams,
  filters: JobFilters
) {
  const next = new URLSearchParams(current.toString())

  const loc = filters.locationQuery?.trim()
  if (loc) next.set("location", loc)
  else next.delete("location")

  if (filters.min_salary != null && filters.min_salary > 0) {
    next.set("min_salary", String(filters.min_salary))
  } else {
    next.delete("min_salary")
  }

  if (filters.remote) next.set("remote", "true")
  else next.delete("remote")

  if (filters.hybrid) next.set("hybrid", "true")
  else next.delete("hybrid")

  if (filters.onsite) next.set("onsite", "true")
  else next.delete("onsite")

  if (filters.sponsorship) next.set("sponsorship", "true")
  else next.delete("sponsorship")

  const seniority = normalizeArray(filters.seniority)
  if (seniority?.length) next.set("seniority", seniority.join(","))
  else next.delete("seniority")

  const employment = normalizeArray(filters.employment_type)
  if (employment?.length) next.set("employment", employment.join(","))
  else next.delete("employment")

  if (filters.within && filters.within !== "all") next.set("within", filters.within)
  else next.delete("within")

  const companyIds = normalizeArray(filters.company_ids)
  if (companyIds?.length) next.set("companies", companyIds.join(","))
  else next.delete("companies")

  if (filters.sort) next.set("sort", filters.sort)
  else next.delete("sort")

  const skills = normalizeArray(filters.skills)
  if (skills?.length) next.set("skills", skills.join(","))
  else next.delete("skills")

  const industry = filters.industryQuery?.trim()
  if (industry) next.set("industry", industry)
  else next.delete("industry")

  // Advanced filters
  if (filters.hide_blockers) next.set("hide_blockers", "true")
  else next.delete("hide_blockers")

  const visaFit = normalizeArray(filters.visa_fit)
  if (visaFit?.length) next.set("visa_fit", visaFit.join(","))
  else next.delete("visa_fit")

  if (filters.stem_opt_ready) next.set("stem_opt_ready", "true")
  else next.delete("stem_opt_ready")

  if (filters.e_verify_signal) next.set("e_verify_signal", "true")
  else next.delete("e_verify_signal")

  if (filters.cap_exempt_possible) next.set("cap_exempt_possible", "true")
  else next.delete("cap_exempt_possible")

  if (filters.lca_salary_aligned) next.set("lca_salary_aligned", "true")
  else next.delete("lca_salary_aligned")

  if (filters.ghost_risk_max) next.set("ghost_risk_max", filters.ghost_risk_max)
  else next.delete("ghost_risk_max")

  if (filters.has_salary) next.set("has_salary", "true")
  else next.delete("has_salary")

  if (filters.direct_ats_only) next.set("direct_ats_only", "true")
  else next.delete("direct_ats_only")

  return next
}

export function buildFilterPills(filters: JobFilters): FilterPill[] {
  const pills: FilterPill[] = []

  if (filters.remote) {
    pills.push({
      id: "remote",
      label: "Remote only",
      nextFilters: { ...filters, remote: false },
      tone: "remote",
    })
  }

  if (filters.hybrid) {
    pills.push({
      id: "hybrid",
      label: "Hybrid",
      nextFilters: { ...filters, hybrid: false },
      tone: "default",
    })
  }

  if (filters.onsite) {
    pills.push({
      id: "onsite",
      label: "On-site",
      nextFilters: { ...filters, onsite: false },
      tone: "default",
    })
  }

  if (filters.sponsorship) {
    pills.push({
      id: "sponsorship",
      label: "Sponsorship available",
      nextFilters: { ...filters, sponsorship: false },
      tone: "sponsorship",
    })
  }

  if (filters.seniority?.length) {
    const labels = filters.seniority
      .map((v) => SENIORITY_OPTIONS.find((o) => o.value === v)?.label ?? v)
      .join(", ")
    pills.push({
      id: "seniority-group",
      label: labels,
      nextFilters: { ...filters, seniority: undefined },
      tone: "default",
    })
  }

  if (filters.employment_type?.length) {
    const labels = filters.employment_type
      .map((v) => EMPLOYMENT_OPTIONS.find((o) => o.value === v)?.label ?? v)
      .join(", ")
    pills.push({
      id: "employment-group",
      label: labels,
      nextFilters: { ...filters, employment_type: undefined },
      tone: "employment",
    })
  }

  if (filters.within && filters.within !== "all") {
    const option = WITHIN_OPTIONS.find((item) => item.value === filters.within)
    if (option) {
      pills.push({
        id: "within",
        label: option.label,
        nextFilters: { ...filters, within: "all" },
        tone: "posted",
      })
    }
  }

  if (filters.company_ids?.length) {
    pills.push({
      id: "companies",
      label:
        filters.company_ids.length === 1
          ? "1 company selected"
          : `${filters.company_ids.length} companies selected`,
      nextFilters: { ...filters, company_ids: undefined },
      tone: "default",
    })
  }

  if (filters.locationQuery?.trim()) {
    pills.push({
      id: "location",
      label: filters.locationQuery.trim(),
      nextFilters: { ...filters, locationQuery: undefined },
      tone: "location",
    })
  }

  if (filters.min_salary && filters.min_salary > 0) {
    pills.push({
      id: "min_salary",
      label: `$${(filters.min_salary / 1000).toFixed(0)}k+`,
      nextFilters: { ...filters, min_salary: undefined },
      tone: "default",
    })
  }

  if (filters.skills?.length) {
    pills.push({
      id: "skills",
      label: filters.skills.join(", "),
      nextFilters: { ...filters, skills: undefined },
      tone: "skills",
    })
  }

  if (filters.industryQuery?.trim()) {
    pills.push({
      id: "industry",
      label: filters.industryQuery.trim(),
      nextFilters: { ...filters, industryQuery: undefined },
      tone: "industry",
    })
  }

  // Advanced filter pills
  if (filters.hide_blockers) {
    pills.push({
      id: "hide_blockers",
      label: "No blockers",
      nextFilters: { ...filters, hide_blockers: undefined },
      tone: "visa",
    })
  }

  if (filters.visa_fit?.length) {
    pills.push({
      id: "visa_fit",
      label: `Visa: ${filters.visa_fit.join(" / ")}`,
      nextFilters: { ...filters, visa_fit: undefined },
      tone: "visa",
    })
  }

  if (filters.stem_opt_ready) {
    pills.push({
      id: "stem_opt_ready",
      label: "STEM OPT ready",
      nextFilters: { ...filters, stem_opt_ready: undefined },
      tone: "visa",
    })
  }

  if (filters.e_verify_signal) {
    pills.push({
      id: "e_verify_signal",
      label: "E-Verify",
      nextFilters: { ...filters, e_verify_signal: undefined },
      tone: "visa",
    })
  }

  if (filters.cap_exempt_possible) {
    pills.push({
      id: "cap_exempt_possible",
      label: "Cap-exempt possible",
      nextFilters: { ...filters, cap_exempt_possible: undefined },
      tone: "visa",
    })
  }

  if (filters.lca_salary_aligned) {
    pills.push({
      id: "lca_salary_aligned",
      label: "LCA aligned",
      nextFilters: { ...filters, lca_salary_aligned: undefined },
      tone: "visa",
    })
  }

  if (filters.ghost_risk_max) {
    pills.push({
      id: "ghost_risk_max",
      label: filters.ghost_risk_max === "low" ? "Low ghost risk" : "Max medium risk",
      nextFilters: { ...filters, ghost_risk_max: undefined },
      tone: "quality",
    })
  }

  if (filters.has_salary) {
    pills.push({
      id: "has_salary",
      label: "Salary listed",
      nextFilters: { ...filters, has_salary: undefined },
      tone: "quality",
    })
  }

  if (filters.direct_ats_only) {
    pills.push({
      id: "direct_ats_only",
      label: "Direct ATS",
      nextFilters: { ...filters, direct_ats_only: undefined },
      tone: "quality",
    })
  }

  return pills
}

interface JobFiltersProps {
  isInternational?: boolean
}

function FilterToggle({
  checked,
  label,
  accent,
  onChange,
}: {
  checked: boolean
  label: string
  accent?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-xl border border-transparent px-2 py-1.5 text-left transition-colors hover:bg-black/[0.02]"
    >
      <span
        className={cn(
          "text-[13px] font-medium",
          accent ? "text-[#5C4EE5]" : "text-[#344054]"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-[#F97316]" : "bg-[#E5E7EB]"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 rounded-full bg-white shadow transition",
            checked ? "translate-x-5" : "translate-x-1"
          )}
        />
      </span>
    </button>
  )
}

function CheckboxOption<T extends string>({
  checked,
  label,
  icon: Icon,
  iconClassName,
  onChange,
}: {
  checked: boolean
  label: string
  icon?: ComponentType<{ className?: string }>
  iconClassName?: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-black/[0.03]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-[#D0D5DD] text-[#F97316] focus:ring-[#F97316]/40"
      />
      {Icon && (
        <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-md", iconClassName)}>
          <Icon className="h-3 w-3" />
        </span>
      )}
      <span className="text-[13px] font-medium text-[#344054]">{label}</span>
    </label>
  )
}

export default function JobFilters({
  isInternational = false,
}: JobFiltersProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseJobFilters(searchParams), [searchParams])

  function replaceFilters(nextFilters: JobFilters) {
    const next = filtersToSearchParams(searchParams, nextFilters)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function toggleArray(
    key: "seniority" | "employment_type",
    value: string,
    checked: boolean
  ) {
    const current = filters[key] ?? []
    const nextValues = checked
      ? [...current, value]
      : current.filter((item) => item !== value)

    replaceFilters({
      ...filters,
      [key]: nextValues.length ? nextValues : undefined,
    })
  }

  const pills = buildFilterPills(filters)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#98A2B3]">
          Filter jobs
        </p>
        {pills.length > 0 && (
          <button
            type="button"
            onClick={() =>
              replaceFilters({
                ...clearedJobFilters(),
                sort: filters.sort,
              })
            }
            className="text-xs font-semibold text-[#F97316] transition-colors hover:text-[#EA580C]"
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-2 border-b border-[#E9ECF2] pb-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#98A2B3]">Work mode</p>
        <div className="space-y-1">
          <FilterToggle
            checked={Boolean(filters.remote)}
            label="Remote only"
            onChange={(checked) =>
              replaceFilters({ ...filters, remote: checked || undefined })
            }
          />
          <FilterToggle
            checked={Boolean(filters.hybrid)}
            label="Hybrid"
            onChange={(checked) =>
              replaceFilters({ ...filters, hybrid: checked || undefined })
            }
          />
          <FilterToggle
            checked={Boolean(filters.onsite)}
            label="On-site"
            onChange={(checked) =>
              replaceFilters({ ...filters, onsite: checked || undefined })
            }
          />
        </div>
        {isInternational && (
          <div className="pt-1">
            <FilterToggle
              checked={Boolean(filters.sponsorship)}
              label="Visa / sponsorship"
              accent
              onChange={(checked) =>
                replaceFilters({ ...filters, sponsorship: checked || undefined })
              }
            />
          </div>
        )}
      </div>

      <div className="border-b border-[#E9ECF2] pb-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#98A2B3]">Experience level</p>
        <div className="space-y-0.5">
          {SENIORITY_OPTIONS.map((option) => (
            <CheckboxOption
              key={option.value}
              checked={filters.seniority?.includes(option.value) ?? false}
              label={option.label}
              onChange={(checked) => toggleArray("seniority", option.value, checked)}
            />
          ))}
        </div>
      </div>

      <div className="border-b border-[#E9ECF2] pb-4">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#98A2B3]">Job type</p>
        <div className="space-y-0.5">
          {EMPLOYMENT_OPTIONS.map((option) => (
            <CheckboxOption
              key={option.value}
              checked={filters.employment_type?.includes(option.value) ?? false}
              label={option.label}
              onChange={(checked) =>
                toggleArray("employment_type", option.value, checked)
              }
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#98A2B3]">Posted within</p>
        <select
          value={filters.within ?? "all"}
          onChange={(event) =>
            replaceFilters({
              ...filters,
              within: event.target.value as JobWithinWindow,
            })
          }
          className="w-full rounded-xl border border-[#E4E7EC] bg-white px-3 py-2.5 text-[13px] font-medium text-[#344054] outline-none transition-colors focus:border-[#F97316] focus:ring-2 focus:ring-[#FDBA74]/40"
        >
          {WITHIN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
