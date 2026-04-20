"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Building2, ChevronDown, SlidersHorizontal } from "lucide-react"
import CompanyCard from "@/components/companies/CompanyCard"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import type { Company, CompanySize } from "@/types"

const PAGE_SIZE = 24
const ATS_OPTIONS = ["greenhouse", "lever", "workday", "icims", "bamboohr", "ashby", "custom"]
const SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: "startup",    label: "Startup"    },
  { value: "small",      label: "Small"      },
  { value: "medium",     label: "Medium"     },
  { value: "large",      label: "Large"      },
  { value: "enterprise", label: "Enterprise" },
]
const SORT_OPTIONS = [
  { value: "job_count",              label: "Most jobs"         },
  { value: "sponsorship_confidence", label: "Highest sponsor score" },
  { value: "created_at",             label: "Recently added"   },
  { value: "name",                   label: "Alphabetical"     },
]

export default function CompaniesPage() {
  const router      = useRouter()
  const searchParams = useSearchParams()
  const { user }    = useAuth()
  const { addCompany, removeCompany, isWatching } = useWatchlist(user?.id)

  const [all,        setAll]        = useState<Company[]>([])
  const [industries, setIndustries] = useState<string[]>([])
  const [newToday,   setNewToday]   = useState<Record<string, number>>({})
  const [total,      setTotal]      = useState(0)
  const [isLoading,  setIsLoading]  = useState(true)
  const [offset,     setOffset]     = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const [industryOpen, setIndustryOpen] = useState(false)

  // Filter state derived from URL
  const selectedIndustries = useMemo(
    () => searchParams.get("industry")?.split(",").filter(Boolean) ?? [],
    [searchParams]
  )
  const selectedSizes = useMemo(
    () => (searchParams.get("size")?.split(",").filter(Boolean) ?? []) as CompanySize[],
    [searchParams]
  )
  const selectedAts    = searchParams.get("ats") ?? ""
  const sponsorsH1b    = searchParams.get("sponsors_h1b") === "1"
  const hasJobs        = searchParams.get("has_jobs") === "1"
  const sort           = searchParams.get("sort") ?? "job_count"

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    setOffset(0)
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  function toggleList(key: string, current: string[], value: string) {
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    update(key, next.join(",") || null)
  }

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const supabase = createClient()

      let q = supabase.from("companies").select("*", { count: "exact" }).eq("is_active", true)
      if (selectedIndustries.length === 1) q = q.eq("industry", selectedIndustries[0])
      else if (selectedIndustries.length > 1) q = (q as any).in("industry", selectedIndustries)
      if (selectedSizes.length === 1) q = q.eq("size", selectedSizes[0])
      else if (selectedSizes.length > 1) q = (q as any).in("size", selectedSizes)
      if (selectedAts) q = q.eq("ats_type", selectedAts)
      if (sponsorsH1b) q = q.eq("sponsors_h1b", true)
      if (hasJobs) q = q.gt("job_count", 0)

      const sortMap: Record<string, { col: string; asc: boolean }> = {
        job_count:              { col: "job_count",              asc: false },
        sponsorship_confidence: { col: "sponsorship_confidence", asc: false },
        created_at:             { col: "created_at",             asc: false },
        name:                   { col: "name",                   asc: true  },
      }
      const { col, asc } = sortMap[sort] ?? sortMap.job_count
      const { data, count } = await q.order(col, { ascending: asc }).range(offset, offset + PAGE_SIZE - 1)

      if (offset === 0) setAll((data as Company[]) ?? [])
      else setAll((prev) => [...prev, ...((data as Company[]) ?? [])])
      setTotal(count ?? 0)
      setIsLoading(false)
    }

    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndustries.join(","), selectedSizes.join(","), selectedAts, sponsorsH1b, hasJobs, sort, offset])

  // Fetch distinct industries for the filter dropdown
  useEffect(() => {
    async function loadIndustries() {
      const supabase = createClient()
      const { data } = await supabase.from("companies").select("industry").eq("is_active", true)
      const unique = Array.from(new Set(
        (data ?? []).map((r: any) => r.industry).filter(Boolean)
      )).sort() as string[]
      setIndustries(unique)
    }
    void loadIndustries()
  }, [])

  // Fetch new-today counts per company
  useEffect(() => {
    async function loadNewToday() {
      const supabase = createClient()
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const { data } = await (supabase
        .from("jobs")
        .select("company_id")
        .eq("is_active", true)
        .gte("first_detected_at", start.toISOString()) as any)

      const map: Record<string, number> = {}
      for (const row of (data ?? []) as { company_id: string }[]) {
        map[row.company_id] = (map[row.company_id] ?? 0) + 1
      }
      setNewToday(map)
    }
    void loadNewToday()
  }, [])

  const activeFilterCount =
    selectedIndustries.length + selectedSizes.length +
    (selectedAts ? 1 : 0) + (sponsorsH1b ? 1 : 0) + (hasJobs ? 1 : 0)

  return (
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">
      <div className="app-shell max-w-7xl space-y-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))]">
        <DashboardPageHeader
          kicker="Company explorer"
          title="Companies we track"
          description={`Tracking ${total.toLocaleString()} companies${activeFilterCount > 0 ? ` · ${activeFilterCount} active filter${activeFilterCount !== 1 ? "s" : ""}` : ""}`}
          backHref="/dashboard"
          backLabel="Back to dashboard"
          meta={
            <Link
              href="/dashboard/search"
              className="subpage-back"
            >
              Search jobs and companies
            </Link>
          }
        />

        {/* Header */}
        <section className="surface-card rounded-lg px-5 py-5 md:px-6 md:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-[16px] bg-[#FFF1E8]">
                  <Building2 className="h-5 w-5 text-[#FF5C18]" />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#FF5C18]">
                  Company Explorer
                </p>
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                Refine the list
              </h2>
              <p className="mt-2 text-sm text-gray-500">
                Sort by hiring volume, sponsorship signal, or ATS footprint and narrow the list to the companies worth attention now.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              {/* Sort */}
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => update("sort", e.target.value)}
                  className="appearance-none rounded-2xl border border-gray-200 bg-white pl-4 pr-9 py-2.5 text-sm font-medium text-gray-700 outline-none transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/15"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>

              {/* Filters toggle */}
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-medium transition",
                  showFilters || activeFilterCount > 0
                    ? "border-[#FF5C18] bg-[#FFF1E8] text-[#FF5C18]"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                )}
              >
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5C18] text-[10px] font-bold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Filter panel */}
          {showFilters && (
            <div className="surface-inset mt-5 space-y-4 p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {/* Industry dropdown */}
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-500">Industry</p>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIndustryOpen((v) => !v)}
                      className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-700 transition hover:border-gray-300"
                    >
                      <span className="truncate">
                        {selectedIndustries.length > 0
                          ? `${selectedIndustries.length} selected`
                          : "All industries"}
                      </span>
                      <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
                    </button>
                    {industryOpen && (
                      <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-2xl border border-gray-200 bg-white py-1 shadow-[0_18px_40px_rgba(15,23,42,0.12)]">
                        {industries.map((ind) => (
                          <button
                            key={ind}
                            type="button"
                            onClick={() => toggleList("industry", selectedIndustries, ind)}
                            className={cn(
                              "flex w-full items-center gap-2 px-3 py-2 text-sm transition hover:bg-gray-50",
                              selectedIndustries.includes(ind) ? "text-[#FF5C18] font-medium" : "text-gray-700"
                            )}
                          >
                            <span className={cn(
                              "h-4 w-4 flex-shrink-0 rounded border transition",
                              selectedIndustries.includes(ind)
                                ? "border-[#FF5C18] bg-[#FF5C18]"
                                : "border-gray-300"
                            )} />
                            {ind}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ATS type */}
                <div>
                  <p className="mb-2 text-xs font-semibold text-gray-500">ATS type</p>
                  <div className="relative">
                    <select
                      value={selectedAts}
                      onChange={(e) => update("ats", e.target.value || null)}
                      className="w-full appearance-none rounded-xl border border-gray-200 bg-white pl-3 pr-9 py-2.5 text-sm text-gray-700 outline-none transition focus:border-[#FF5C18]"
                    >
                      <option value="">Any ATS</option>
                      {ATS_OPTIONS.map((ats) => (
                        <option key={ats} value={ats}>
                          {ats.charAt(0).toUpperCase() + ats.slice(1)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  </div>
                </div>

                {/* Toggles */}
                <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-2">
                  <p className="text-xs font-semibold text-gray-500">Quick filters</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => update("sponsors_h1b", sponsorsH1b ? null : "1")}
                      className={cn(
                        "rounded-xl border px-4 py-2 text-sm font-medium transition",
                        sponsorsH1b
                          ? "border-[#FF5C18] bg-[#FFF1E8] text-[#FF5C18]"
                          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      Sponsors H-1B
                    </button>
                    <button
                      type="button"
                      onClick={() => update("has_jobs", hasJobs ? null : "1")}
                      className={cn(
                        "rounded-xl border px-4 py-2 text-sm font-medium transition",
                        hasJobs
                          ? "border-[#FF5C18] bg-[#FFF1E8] text-[#FF5C18]"
                          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      Currently hiring
                    </button>
                  </div>
                </div>
              </div>

              {/* Size filter pills */}
              <div>
                <p className="mb-2 text-xs font-semibold text-gray-500">Company size</p>
                <div className="flex flex-wrap gap-2">
                  {SIZE_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => toggleList("size", selectedSizes, o.value)}
                      className={cn(
                        "rounded-xl border px-3 py-1.5 text-sm font-medium transition",
                        selectedSizes.includes(o.value)
                          ? "border-[#FF5C18] bg-[#FFF1E8] text-[#FF5C18]"
                          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    router.replace("/dashboard/companies", { scroll: false })
                    setOffset(0)
                  }}
                  className="text-sm text-red-500 hover:text-red-700 transition"
                >
                  Clear all filters
                </button>
              )}
            </div>
          )}
        </section>

        {/* Grid */}
        {isLoading && all.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="surface-card h-52 animate-pulse" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <div className="empty-state py-12">
            <p className="text-lg font-semibold text-gray-900">No companies match your filters</p>
            <p className="mt-2 text-sm text-gray-500">Try removing some filters to see more results.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {all.map((company) => (
              <CompanyCard
                key={company.id}
                company={company}
                newJobsToday={newToday[company.id]}
                isWatching={isWatching(company.id)}
                onWatch={(id) => void addCompany(id)}
                onUnwatch={(id) => void removeCompany(id)}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {!isLoading && all.length < total && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="rounded-2xl border border-gray-200 bg-white px-6 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
            >
              Load more companies
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
