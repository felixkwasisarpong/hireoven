"use client"

import { useMemo } from "react"
import {
  usePathname,
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation"
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
      className="flex w-full items-center justify-between rounded-xl border border-slate-200/80 bg-white px-3.5 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50"
    >
      <span
        className={`text-sm ${
          accent ? "font-medium text-[#FF5C18]" : "text-gray-700"
        }`}
      >
        {label}
      </span>
      <span
        className={`relative inline-flex h-6 w-10 items-center rounded-full transition ${
          checked ? "bg-[#FF5C18]" : "bg-gray-200"
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
  onChange,
}: {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-slate-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-[#FF5C18] focus:ring-[#FF5C18]"
      />
      <span className="text-sm text-gray-700">{label}</span>
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
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
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
                within: "all",
              })
            }
            className="text-xs font-medium text-gray-500 transition hover:text-gray-800"
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-3 border-b border-slate-200/80 pb-4">
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

      <div className="border-b border-slate-200/80 pb-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Seniority level</p>
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

      <div className="border-b border-slate-200/80 pb-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Employment type</p>
        <div className="space-y-1">
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
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Posted within</p>
        <select
          value={filters.within ?? "all"}
          onChange={(event) =>
            replaceFilters({
              ...filters,
              within: event.target.value as JobWithinWindow,
            })
          }
          className="w-full rounded-2xl border border-slate-200/80 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none shadow-[0_8px_20px_rgba(15,23,42,0.03)] transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/20"
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
