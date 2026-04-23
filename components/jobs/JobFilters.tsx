"use client"

import { useMemo, type ComponentType } from "react"
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation"
import {
  Briefcase,
  ChevronRight,
  ClipboardList,
  Clock3,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  EmploymentType,
  JobFilters,
  JobSortOption,
  JobWithinWindow,
  SeniorityLevel,
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
]

export const SORT_OPTIONS: {
  value: JobSortOption
  label: string
}[] = [
  { value: "freshest", label: "Freshest first" },
  { value: "match", label: "Best match" },
  { value: "relevant", label: "Most relevant" },
]

type FilterPill = {
  id: string
  label: string
  nextFilters: JobFilters
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
  const sort = (params.get("sort") as JobSortOption | null) ?? "freshest"

  return {
    remote: params.get("remote") === "true",
    sponsorship: params.get("sponsorship") === "true",
    seniority: parseList<SeniorityLevel>(params, "seniority"),
    employment_type: parseList<EmploymentType>(params, "employment"),
    within,
    company_ids: parseList<string>(params, "companies"),
    sort,
  }
}

export function filtersToSearchParams(
  current: URLSearchParams | ReadonlyURLSearchParams,
  filters: JobFilters
) {
  const next = new URLSearchParams(current.toString())
  next.delete("location")

  if (filters.remote) next.set("remote", "true")
  else next.delete("remote")

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

  if (filters.sort && filters.sort !== "freshest") next.set("sort", filters.sort)
  else next.delete("sort")

  return next
}

export function buildFilterPills(filters: JobFilters): FilterPill[] {
  const pills: FilterPill[] = []

  if (filters.remote) {
    pills.push({
      id: "remote",
      label: "Remote only",
      nextFilters: { ...filters, remote: false },
    })
  }

  if (filters.sponsorship) {
    pills.push({
      id: "sponsorship",
      label: "Needs sponsorship",
      nextFilters: { ...filters, sponsorship: false },
    })
  }

  for (const option of SENIORITY_OPTIONS) {
    if (!filters.seniority?.includes(option.value)) continue
    pills.push({
      id: `seniority-${option.value}`,
      label: option.label,
      nextFilters: {
        ...filters,
        seniority: filters.seniority.filter((value) => value !== option.value),
      },
    })
  }

  for (const option of EMPLOYMENT_OPTIONS) {
    if (!filters.employment_type?.includes(option.value)) continue
    pills.push({
      id: `employment-${option.value}`,
      label: option.label,
      nextFilters: {
        ...filters,
        employment_type: filters.employment_type.filter(
          (value) => value !== option.value
        ),
      },
    })
  }

  if (filters.within && filters.within !== "all") {
    const option = WITHIN_OPTIONS.find((item) => item.value === filters.within)
    if (option) {
      pills.push({
        id: "within",
        label: option.label,
        nextFilters: { ...filters, within: "all" },
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
      className="flex w-full items-center justify-between rounded-xl border border-transparent px-2 py-1 text-left transition-colors"
    >
      <span
        className={`text-sm ${
          accent ? "font-medium text-[#5C4EE5]" : "text-[#223050]"
        }`}
      >
        {label}
      </span>
      <span
        className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
          checked ? "bg-[#614DF0]" : "bg-[#D6DBE7]"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${
            checked ? "translate-x-5" : "translate-x-1"
          }`}
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
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[#F3F5FC]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-[#C8CFDF] text-[#5E4EF1] focus:ring-[#5E4EF1]"
      />
      {Icon && (
        <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-md", iconClassName)}>
          <Icon className="h-3 w-3" />
        </span>
      )}
      <span className="text-sm text-strong">{label}</span>
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
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          Filters
        </p>
        {pills.length > 0 && (
          <button
            type="button"
            onClick={() =>
              replaceFilters({
                ...filters,
                remote: false,
                sponsorship: false,
                seniority: undefined,
                employment_type: undefined,
                company_ids: undefined,
                within: "all",
              })
            }
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-strong"
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-3 border-b border-border/70 pb-4">
        <FilterToggle
          checked={Boolean(filters.remote)}
          label="Remote only"
          onChange={(checked) =>
            replaceFilters({ ...filters, remote: checked || undefined })
          }
        />
        <FilterToggle
          checked={Boolean(filters.sponsorship)}
          label="Needs sponsorship"
          accent={isInternational}
          onChange={(checked) =>
            replaceFilters({ ...filters, sponsorship: checked || undefined })
          }
        />
      </div>

      <div className="border-b border-border/70 pb-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Seniority level</p>
        <div className="space-y-1">
          {SENIORITY_OPTIONS.map((option) => (
            <CheckboxOption
              key={option.value}
              checked={filters.seniority?.includes(option.value) ?? false}
              label={option.label}
              onChange={(checked) =>
                toggleArray("seniority", option.value, checked)
              }
            />
          ))}
        </div>
      </div>

      <div className="border-b border-border/70 pb-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Employment type</p>
        <div className="space-y-1">
          {EMPLOYMENT_OPTIONS.map((option) => (
            <CheckboxOption
              key={option.value}
              checked={filters.employment_type?.includes(option.value) ?? false}
              label={option.label}
              icon={
                option.value === "fulltime"
                  ? Briefcase
                  : option.value === "parttime"
                    ? Clock3
                    : option.value === "contract"
                      ? ClipboardList
                      : Sparkles
              }
              iconClassName={
                option.value === "fulltime"
                  ? "bg-emerald-100 text-emerald-700"
                  : option.value === "parttime"
                    ? "bg-violet-100 text-violet-700"
                    : option.value === "contract"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-orange-100 text-orange-700"
              }
              onChange={(checked) =>
                toggleArray("employment_type", option.value, checked)
              }
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Posted within</p>
        <select
          value={filters.within ?? "all"}
          onChange={(event) =>
            replaceFilters({
              ...filters,
              within: event.target.value as JobWithinWindow,
            })
          }
          className="w-full rounded-xl border border-[#D7DCEA] bg-white px-3 py-2.5 text-sm text-strong outline-none transition-colors focus:border-[#897EFB] focus:ring-2 focus:ring-[#DBD6FF]"
        >
          {WITHIN_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-[#DCD5F8] bg-[#EEE9FF] p-3">
        <div className="flex items-start gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#FCEFD4] text-[#F39B2F]">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#1E2A4E]">Unlock all filters</p>
            <p className="mt-0.5 text-xs leading-4 text-[#7A84A3]">
              Get better recommendations and priority support.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/dashboard/upgrade")}
          className="mt-3 inline-flex w-full items-center justify-between rounded-lg border border-[#D7CCFF] bg-[#F7F4FF] px-3 py-2 text-sm font-semibold text-[#5E4EF1] transition-colors hover:bg-[#EFEAFF]"
        >
          Upgrade now
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
