"use client"

import type { Dispatch, RefObject, SetStateAction } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Briefcase,
  Building2,
  ChevronDown,
  Clock,
  DollarSign,
  Globe2,
  MapPin,
  Plane,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tag,
  X,
} from "lucide-react"
import {
  EMPLOYMENT_OPTIONS,
  SENIORITY_OPTIONS,
  SORT_OPTIONS,
  WITHIN_OPTIONS,
  buildFilterPills,
  clearedJobFilters,
  filtersToSearchParams,
  pillToneClasses,
  type FilterPill,
} from "@/components/jobs/JobFilters"
import { searchQueryToParams } from "@/components/jobs/JobSearch"
import AdvancedFiltersDrawer from "@/components/jobs/AdvancedFiltersDrawer"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import type { EmploymentType, JobFilters, SeniorityLevel } from "@/types"

/**
 * Small Sparkles badge that appears on a filter button when Scout just changed it.
 * Sits in the top-right corner of the button's relative wrapper.
 */
function ScoutPulseBadge() {
  return (
    <span
      className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 shadow-sm ring-2 ring-white"
      aria-hidden
    >
      <Sparkles className="h-2.5 w-2.5 text-white" />
    </span>
  )
}

const SALARY_TIERS = [
  { label: "Any", value: undefined as number | undefined },
  { label: "$80k+", value: 80_000 },
  { label: "$100k+", value: 100_000 },
  { label: "$120k+", value: 120_000 },
  { label: "$150k+", value: 150_000 },
  { label: "$200k+", value: 200_000 },
] as const

export type FeedToolbarDropdown =
  | "location"
  | "jobtype"
  | "salary"
  | "more"
  | "experience"
  | "sponsorship"
  | "posted"
  | "skills"
  | "industry"
  | "keywords"
  | null

type Props = {
  filters: JobFilters
  searchQuery: string
  feedMeta: { totalCount: number }
  filterDropdown: FeedToolbarDropdown
  setFilterDropdown: Dispatch<SetStateAction<FeedToolbarDropdown>>
  filtersBarRef: RefObject<HTMLDivElement | null>
  isInternational?: boolean
}

export default function DashboardFeedToolbar({
  filters,
  searchQuery,
  feedMeta,
  filterDropdown,
  setFilterDropdown,
  filtersBarRef,
  isInternational = false,
}: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pills = useMemo(() => buildFilterPills(filters), [filters])

  const [locationDraft, setLocationDraft] = useState(filters.locationQuery ?? "")
  const [skillsDraft, setSkillsDraft] = useState(filters.skills?.join(", ") ?? "")
  const [industryDraft, setIndustryDraft] = useState(filters.industryQuery ?? "")
  const [keywordsDraft, setKeywordsDraft] = useState(searchQuery)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Set of toolbar button keys that Scout just changed — cleared after the pulse animation
  const [scoutPulse, setScoutPulse] = useState<Set<string>>(new Set())
  const scoutPulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Map APPLY_FILTERS URL param keys → toolbar button identifiers
  const PARAM_TO_BUTTON: Record<string, string> = {
    q: "keywords",
    location: "location",
    sponsorship: "sponsorship",
    workMode: "remote",
  }

  useEffect(() => {
    function handleFiltersApplied(e: Event) {
      const paramKeys: string[] =
        (e as CustomEvent<{ paramKeys: string[] }>).detail?.paramKeys ?? []
      const buttonKeys = new Set(
        paramKeys.flatMap((k) => (PARAM_TO_BUTTON[k] ? [PARAM_TO_BUTTON[k]] : []))
      )
      if (buttonKeys.size === 0) return
      if (scoutPulseTimerRef.current) clearTimeout(scoutPulseTimerRef.current)
      setScoutPulse(buttonKeys)
      scoutPulseTimerRef.current = setTimeout(() => setScoutPulse(new Set()), 2800)
    }

    function handleFiltersRestored() {
      if (scoutPulseTimerRef.current) clearTimeout(scoutPulseTimerRef.current)
      setScoutPulse(new Set())
    }

    window.addEventListener("scout:filters-applied", handleFiltersApplied)
    window.addEventListener("scout:filters-restored", handleFiltersRestored)
    return () => {
      window.removeEventListener("scout:filters-applied", handleFiltersApplied)
      window.removeEventListener("scout:filters-restored", handleFiltersRestored)
      if (scoutPulseTimerRef.current) clearTimeout(scoutPulseTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const replaceFilters = (nextFilters: JobFilters) => {
    const next = filtersToSearchParams(searchParams, nextFilters)
    const withSearch = searchQueryToParams(next, searchQuery)
    const value = withSearch.toString()
    router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false })
  }

  const replaceSearchQuery = (q: string) => {
    const next = searchQueryToParams(filtersToSearchParams(searchParams, filters), q)
    const value = next.toString()
    router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false })
  }

  const clearAll = () => {
    const nextFilters = { ...clearedJobFilters(), sort: filters.sort }
    const next = searchQueryToParams(filtersToSearchParams(searchParams, nextFilters), "")
    const value = next.toString()
    router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false })
  }

  const moreFilterCount = useMemo(() => {
    let n = 0
    if (filters.hybrid) n++
    if (filters.onsite) n++
    if (filters.company_ids?.length) n++
    if (filters.hide_blockers) n++
    if (filters.visa_fit?.length) n++
    if (filters.stem_opt_ready) n++
    if (filters.e_verify_signal) n++
    if (filters.cap_exempt_possible) n++
    if (filters.lca_salary_aligned) n++
    if (filters.ghost_risk_max) n++
    if (filters.has_salary) n++
    if (filters.direct_ats_only) n++
    return n
  }, [filters])

  const salaryLabel = filters.min_salary
    ? SALARY_TIERS.find((t) => t.value === filters.min_salary)?.label ??
      `$${(filters.min_salary / 1000).toFixed(0)}k+`
    : "Salary"

  const locationLabel =
    filters.locationQuery?.trim() || (filters.remote ? "Remote" : "Location")

  const jobtypeLabel = filters.employment_type?.length
    ? filters.employment_type.length === 1
      ? (EMPLOYMENT_OPTIONS.find((o) => o.value === filters.employment_type![0])?.label ?? "Job type")
      : `${filters.employment_type.length} types`
    : "Job type"

  const experienceLabel = filters.seniority?.length
    ? filters.seniority.length === 1
      ? (SENIORITY_OPTIONS.find((o) => o.value === filters.seniority![0])?.label ?? "Experience")
      : `${filters.seniority.length} levels`
    : "Experience"

  const postedLabel =
    WITHIN_OPTIONS.find((o) => o.value === (filters.within ?? "all"))?.label ?? "Posted"

  const sortValue = filters.sort ?? "freshest"

  useEffect(() => {
    if (filterDropdown === "keywords") setKeywordsDraft(searchQuery)
  }, [filterDropdown, searchQuery])

  function openDropdown(next: Exclude<FeedToolbarDropdown, null>) {
    setFilterDropdown((d) => (d === next ? null : next))
    if (next === "location") setLocationDraft(filters.locationQuery ?? "")
    if (next === "skills") setSkillsDraft(filters.skills?.join(", ") ?? "")
    if (next === "industry") setIndustryDraft(filters.industryQuery ?? "")
    if (next === "keywords") setKeywordsDraft(searchQuery)
  }

  function focusHeaderSearch() {
    setFilterDropdown(null)
    document.getElementById("dashboard-feed-q")?.focus()
  }

  const pillIcon = (pill: FilterPill) => {
    if (pill.tone === "sponsorship") return <Plane className="h-3 w-3 shrink-0" />
    if (pill.tone === "location") return <MapPin className="h-3 w-3 shrink-0" />
    if (pill.tone === "employment") return <Briefcase className="h-3 w-3 shrink-0" />
    return null
  }

  type FilterTone =
    | "blue"
    | "sky"
    | "violet"
    | "indigo"
    | "emerald"
    | "amber"
    | "slate"
    | "cyan"
    | "teal"
    | "rose"

  const TONE_STYLES: Record<
    FilterTone,
    { idleIcon: string; activeWrap: string; activeIcon: string }
  > = {
    blue: {
      idleIcon: "text-blue-500",
      activeWrap: "border-blue-200 bg-blue-50 text-blue-800 ring-1 ring-blue-200/70",
      activeIcon: "text-blue-600",
    },
    sky: {
      idleIcon: "text-sky-500",
      activeWrap: "border-sky-200 bg-sky-50 text-sky-800 ring-1 ring-sky-200/70",
      activeIcon: "text-sky-600",
    },
    violet: {
      idleIcon: "text-orange-500",
      activeWrap: "border-orange-200 bg-orange-50 text-orange-800 ring-1 ring-orange-200/70",
      activeIcon: "text-orange-600",
    },
    indigo: {
      idleIcon: "text-indigo-500",
      activeWrap: "border-indigo-200 bg-indigo-50 text-indigo-800 ring-1 ring-indigo-200/70",
      activeIcon: "text-indigo-600",
    },
    emerald: {
      idleIcon: "text-emerald-600",
      activeWrap: "border-emerald-200 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/70",
      activeIcon: "text-emerald-700",
    },
    amber: {
      idleIcon: "text-amber-500",
      activeWrap: "border-amber-200 bg-amber-50 text-amber-900 ring-1 ring-amber-200/70",
      activeIcon: "text-amber-600",
    },
    slate: {
      idleIcon: "text-slate-500",
      activeWrap: "border-slate-300 bg-slate-100 text-slate-800 ring-1 ring-slate-200/70",
      activeIcon: "text-slate-700",
    },
    cyan: {
      idleIcon: "text-cyan-600",
      activeWrap: "border-cyan-200 bg-cyan-50 text-cyan-800 ring-1 ring-cyan-200/70",
      activeIcon: "text-cyan-700",
    },
    teal: {
      idleIcon: "text-teal-600",
      activeWrap: "border-teal-200 bg-teal-50 text-teal-800 ring-1 ring-teal-200/70",
      activeIcon: "text-teal-700",
    },
    rose: {
      idleIcon: "text-rose-500",
      activeWrap: "border-rose-200 bg-rose-50 text-rose-800 ring-1 ring-rose-200/70",
      activeIcon: "text-rose-600",
    },
  }

  const filterBtn = (active: boolean, tone: FilterTone = "blue") =>
    cn(
      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border bg-white px-3 text-[13px] font-medium shadow-sm transition",
      active
        ? TONE_STYLES[tone].activeWrap
        : "border-[#E5E7EB] text-slate-700 hover:border-slate-300 hover:bg-slate-50/80"
    )

  const iconCls = (active: boolean, tone: FilterTone) =>
    cn(
      "h-3.5 w-3.5",
      active ? TONE_STYLES[tone].activeIcon : TONE_STYLES[tone].idleIcon
    )

  return (
    <div
      ref={filtersBarRef as RefObject<HTMLDivElement>}
      className="space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          <span className="text-lg font-bold tracking-tight text-slate-900">
            {feedMeta.totalCount.toLocaleString()}
          </span>{" "}
          Jobs found
        </p>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-slate-500">Sort by:</span>
          <select
            value={sortValue}
            onChange={(e) =>
              replaceFilters({
                ...filters,
                sort: e.target.value as JobFilters["sort"],
              })
            }
            className="h-9 min-w-[10.5rem] rounded-md border border-[#E5E7EB] bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-[#0052CC] focus:ring-1 focus:ring-[#0052CC]/20"
            aria-label="Sort jobs"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          {scoutPulse.has("keywords") && <ScoutPulseBadge />}
          <button
            type="button"
            onClick={() => (filterDropdown === "keywords" ? setFilterDropdown(null) : openDropdown("keywords"))}
            className={cn(
              filterBtn(Boolean(searchQuery.trim()), "blue"),
              scoutPulse.has("keywords") && "ring-2 ring-orange-400/60 ring-offset-1"
            )}
          >
            <Search className={iconCls(Boolean(searchQuery.trim()), "blue")} />
            Keywords
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
          {filterDropdown === "keywords" && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Search keywords
              </p>
              <input
                autoFocus
                type="text"
                value={keywordsDraft}
                onChange={(e) => setKeywordsDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    replaceSearchQuery(keywordsDraft)
                    setFilterDropdown(null)
                  }
                }}
                placeholder="Job title, company, skills…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#0052CC]/40 focus:ring-2 focus:ring-[#0052CC]/10"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    focusHeaderSearch()
                  }}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Use header search
                </button>
                <button
                  type="button"
                  onClick={() => {
                    replaceSearchQuery(keywordsDraft)
                    setFilterDropdown(null)
                  }}
                  className="flex-1 rounded-lg bg-[#0052CC] py-1.5 text-xs font-semibold text-white hover:bg-[#0041a3]"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          {scoutPulse.has("location") && <ScoutPulseBadge />}
          <button
            type="button"
            onClick={() => openDropdown("location")}
            className={cn(
              filterBtn(Boolean(filters.locationQuery?.trim()) || Boolean(filters.remote), "sky"),
              scoutPulse.has("location") && "ring-2 ring-orange-400/60 ring-offset-1"
            )}
          >
            <MapPin
              className={iconCls(
                Boolean(filters.locationQuery?.trim()) || Boolean(filters.remote),
                "sky"
              )}
            />
            <span className="max-w-[120px] truncate">{locationLabel}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
          {filterDropdown === "location" && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Location</p>
              <input
                autoFocus
                type="text"
                value={locationDraft}
                onChange={(e) => setLocationDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    replaceFilters({ ...filters, locationQuery: locationDraft.trim() || undefined })
                    setFilterDropdown(null)
                  }
                }}
                placeholder="City, state, country…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#0052CC]/40 focus:ring-2 focus:ring-[#0052CC]/10"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    replaceFilters({ ...filters, remote: !filters.remote, locationQuery: undefined })
                    setFilterDropdown(null)
                  }}
                  className={cn(
                    "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition",
                    filters.remote
                      ? "border-[#0052CC]/30 bg-[#0052CC]/10 text-[#0052CC]"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  Remote only
                </button>
                <button
                  type="button"
                  onClick={() => {
                    replaceFilters({ ...filters, locationQuery: locationDraft.trim() || undefined })
                    setFilterDropdown(null)
                  }}
                  className="flex-1 rounded-lg bg-[#0052CC] py-1.5 text-xs font-semibold text-white hover:bg-[#0041a3]"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => openDropdown("jobtype")}
            className={filterBtn(Boolean(filters.employment_type?.length), "violet")}
          >
            <Briefcase className={iconCls(Boolean(filters.employment_type?.length), "violet")} />
            {jobtypeLabel}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
          {filterDropdown === "jobtype" && (
            <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[200px] rounded-xl border border-slate-200 bg-white shadow-lg">
              {EMPLOYMENT_OPTIONS.map((opt) => {
                const active = filters.employment_type?.includes(opt.value) ?? false
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? filters.employment_type?.filter((v: EmploymentType) => v !== opt.value)
                        : [...(filters.employment_type ?? []), opt.value]
                      replaceFilters({ ...filters, employment_type: next?.length ? next : undefined })
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50",
                      active ? "font-semibold text-[#0052CC]" : "text-slate-800"
                    )}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-[#0052CC]" />}
                    {opt.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => openDropdown("experience")}
            className={filterBtn(Boolean(filters.seniority?.length), "indigo")}
          >
            <Tag className={iconCls(Boolean(filters.seniority?.length), "indigo")} />
            {experienceLabel}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
          {filterDropdown === "experience" && (
            <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[200px] rounded-xl border border-slate-200 bg-white shadow-lg">
              {SENIORITY_OPTIONS.map((opt) => {
                const active = filters.seniority?.includes(opt.value) ?? false
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? filters.seniority?.filter((v: SeniorityLevel) => v !== opt.value)
                        : [...(filters.seniority ?? []), opt.value]
                      replaceFilters({ ...filters, seniority: next?.length ? next : undefined })
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50",
                      active ? "font-semibold text-[#0052CC]" : "text-slate-800"
                    )}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-[#0052CC]" />}
                    {opt.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => openDropdown("salary")}
            className={filterBtn(Boolean(filters.min_salary), "emerald")}
          >
            <DollarSign className={iconCls(Boolean(filters.min_salary), "emerald")} />
            {salaryLabel}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
          {filterDropdown === "salary" && (
            <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[180px] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Min salary (USD/yr)
              </p>
              {SALARY_TIERS.map((tier) => {
                const active =
                  tier.value === undefined ? !filters.min_salary : filters.min_salary === tier.value
                return (
                  <button
                    key={tier.label}
                    type="button"
                    onClick={() => {
                      replaceFilters({ ...filters, min_salary: tier.value })
                      setFilterDropdown(null)
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition hover:bg-slate-50",
                      active ? "font-semibold text-[#0052CC]" : "text-slate-800"
                    )}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-[#0052CC]" />}
                    {tier.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="relative">
          {scoutPulse.has("sponsorship") && <ScoutPulseBadge />}
          <button
            type="button"
            onClick={() => replaceFilters({ ...filters, sponsorship: !filters.sponsorship })}
            className={cn(
              filterBtn(Boolean(filters.sponsorship), "emerald"),
              scoutPulse.has("sponsorship") && "ring-2 ring-orange-400/60 ring-offset-1"
            )}
          >
            <Plane className={iconCls(Boolean(filters.sponsorship), "emerald")} />
            Sponsorship
          </button>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => openDropdown("posted")}
            className={filterBtn(
              Boolean(filters.within && filters.within !== "all"),
              "rose"
            )}
          >
            <Clock
              className={iconCls(
                Boolean(filters.within && filters.within !== "all"),
                "rose"
              )}
            />
            {postedLabel}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
          {filterDropdown === "posted" && (
            <div className="absolute left-0 top-full z-50 mt-1.5 min-w-[200px] rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {WITHIN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    replaceFilters({ ...filters, within: opt.value })
                    setFilterDropdown(null)
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-slate-50",
                    (filters.within ?? "all") === opt.value ? "font-semibold text-[#0052CC]" : "text-slate-800"
                  )}
                >
                  {(filters.within ?? "all") === opt.value && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#0052CC]" />
                  )}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          {scoutPulse.has("remote") && <ScoutPulseBadge />}
          <button
            type="button"
            onClick={() => replaceFilters({ ...filters, remote: !filters.remote ? true : false })}
            className={cn(
              filterBtn(Boolean(filters.remote), "cyan"),
              scoutPulse.has("remote") && "ring-2 ring-orange-400/60 ring-offset-1"
            )}
          >
            <Globe2 className={iconCls(Boolean(filters.remote), "cyan")} />
            Remote
          </button>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => openDropdown("skills")}
            className={filterBtn(Boolean(filters.skills?.length), "amber")}
          >
            <Sparkles className={iconCls(Boolean(filters.skills?.length), "amber")} />
            Skills
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
          {filterDropdown === "skills" && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Skills (comma-separated)
              </p>
              <input
                autoFocus
                type="text"
                value={skillsDraft}
                onChange={(e) => setSkillsDraft(e.target.value)}
                placeholder="e.g. Python, AWS, React"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#0052CC]/40 focus:ring-2 focus:ring-[#0052CC]/10"
              />
              <button
                type="button"
                onClick={() => {
                  const parts = skillsDraft
                    .split(",")
                    .map((s: string) => s.trim())
                    .filter(Boolean)
                  replaceFilters({ ...filters, skills: parts.length ? parts : undefined })
                  setFilterDropdown(null)
                }}
                className="mt-2 w-full rounded-lg bg-[#0052CC] py-2 text-xs font-semibold text-white hover:bg-[#0041a3]"
              >
                Apply
              </button>
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => openDropdown("industry")}
            className={filterBtn(Boolean(filters.industryQuery?.trim()), "teal")}
          >
            <Building2 className={iconCls(Boolean(filters.industryQuery?.trim()), "teal")} />
            Industry
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
          {filterDropdown === "industry" && (
            <div className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Industry contains
              </p>
              <input
                autoFocus
                type="text"
                value={industryDraft}
                onChange={(e) => setIndustryDraft(e.target.value)}
                placeholder="e.g. Software, Finance"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-[#0052CC]/40 focus:ring-2 focus:ring-[#0052CC]/10"
              />
              <button
                type="button"
                onClick={() => {
                  replaceFilters({
                    ...filters,
                    industryQuery: industryDraft.trim() || undefined,
                  })
                  setFilterDropdown(null)
                }}
                className="mt-2 w-full rounded-lg bg-[#0052CC] py-2 text-xs font-semibold text-white hover:bg-[#0041a3]"
              >
                Apply
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            setFilterDropdown(null)
            setAdvancedOpen(true)
          }}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white px-3 text-[13px] font-semibold transition shadow-sm",
            moreFilterCount > 0
              ? "border-[#0052CC]/30 bg-sky-50 text-[#0052CC] ring-1 ring-[#0052CC]/15"
              : "border-[#E5E7EB] text-[#0052CC] hover:bg-sky-50/60"
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
          More filters
          {moreFilterCount > 0 && (
            <span className="ml-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[#0052CC] px-1 text-[10px] font-bold leading-none text-white">
              {moreFilterCount}
            </span>
          )}
        </button>
      </div>

      <AdvancedFiltersDrawer
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        filters={filters}
        onFiltersChange={replaceFilters}
        isInternational={isInternational}
      />

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {pills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            onClick={() => replaceFilters(pill.nextFilters)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition",
              pillToneClasses(pill.tone)
            )}
          >
            {pillIcon(pill)}
            {pill.label}
            <X className="h-3 w-3 opacity-70" />
          </button>
        ))}
        {pills.length > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500 transition hover:text-slate-800"
          >
            <RotateCcw className="h-3 w-3" />
            Clear all
          </button>
        )}
      </div>
    </div>
  )
}
