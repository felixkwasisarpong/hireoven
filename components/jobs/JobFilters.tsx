"use client"

import { useEffect, useMemo, useState } from "react"
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
  const location = params.get("location")?.trim() ?? ""

  return {
    remote: params.get("remote") === "true",
    sponsorship: params.get("sponsorship") === "true",
    seniority: parseList<SeniorityLevel>(params, "seniority"),
    employment_type: parseList<EmploymentType>(params, "employment"),
    location: location || undefined,
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

  const location = filters.location?.trim()
  if (location) next.set("location", location)
  else next.delete("location")

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

  if (filters.location?.trim()) {
    pills.push({
      id: "location",
      label: `Location: ${filters.location.trim()}`,
      nextFilters: { ...filters, location: undefined },
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
      className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-surface-alt"
    >
      <span
        className={`text-sm ${
          accent ? "font-medium text-primary" : "text-strong"
        }`}
      >
        {label}
      </span>
      <span
        className={`relative inline-flex h-6 w-10 items-center rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-surface-muted"
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
    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-alt">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
      />
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
  const [locationDraft, setLocationDraft] = useState(filters.location ?? "")

  function replaceFilters(nextFilters: JobFilters) {
    const next = filtersToSearchParams(searchParams, nextFilters)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  useEffect(() => {
    setLocationDraft(filters.location ?? "")
  }, [filters.location])

  useEffect(() => {
    const nextValue = locationDraft.trim()
    const currentValue = filters.location?.trim() ?? ""
    if (nextValue === currentValue) return

    const timeout = window.setTimeout(() => {
      replaceFilters({
        ...filters,
        location: nextValue || undefined,
      })
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [filters, locationDraft, replaceFilters])

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
                location: undefined,
                within: "all",
              })
            }
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-strong"
          >
            Clear
          </button>
        )}
      </div>

      <div className="space-y-3 border-b border-border pb-4">
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

      <div className="border-b border-border pb-4">
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

      <div className="border-b border-border pb-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Employment type</p>
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

      <div className="border-b border-border pb-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Location / country</p>
        <input
          type="text"
          value={locationDraft}
          onChange={(event) => setLocationDraft(event.target.value)}
          placeholder="City, state, country (e.g. USA)"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-strong outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/12"
        />
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
          className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-strong outline-none transition-colors focus:border-primary/50 focus:ring-2 focus:ring-primary/12"
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
