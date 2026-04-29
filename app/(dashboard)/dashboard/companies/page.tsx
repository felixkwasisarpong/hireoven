"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Bookmark, Building2, ChevronDown, Search, X } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { cn } from "@/lib/utils"
import type { Company, CompanySize } from "@/types"

const PAGE_SIZE = 24
const ATS_OPTIONS = ["greenhouse", "lever", "workday", "icims", "bamboohr", "ashby", "jobvite", "custom"]
const SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: "startup",    label: "Startup"    },
  { value: "small",      label: "Small"      },
  { value: "medium",     label: "Medium"     },
  { value: "large",      label: "Large"      },
  { value: "enterprise", label: "Enterprise" },
]
const SORT_OPTIONS = [
  { value: "job_count",              label: "Most jobs"         },
  { value: "sponsorship_confidence", label: "Top sponsor score" },
  { value: "created_at",             label: "Recently added"    },
  { value: "name",                   label: "Alphabetical"      },
]

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  const color =
    pct >= 80 ? "bg-emerald-500" :
    pct >= 60 ? "bg-[#FF5C18]" :
    pct >= 40 ? "bg-amber-400" :
    "bg-gray-200"
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-gray-600">
        {pct}%
      </span>
    </div>
  )
}

function CompanyRow({
  company,
  newJobsToday,
  isWatching,
  onWatch,
  onUnwatch,
}: {
  company: Company
  newJobsToday?: number
  isWatching: boolean
  onWatch: (id: string) => void
  onUnwatch: (id: string) => void
}) {
  return (
    <Link
      href={`/dashboard/companies/${company.id}`}
      className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-orange-50/40"
    >
      {/* Logo */}
      <CompanyLogo
        companyName={company.name}
        domain={company.domain}
        logoUrl={company.logo_url}
        className="h-9 w-9 flex-shrink-0 rounded-xl border border-slate-100 bg-white object-contain p-1 shadow-[0_3px_10px_rgba(15,23,42,0.04)]"
      />

      {/* Name + meta */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900 transition-colors group-hover:text-[#FF5C18]">
          {company.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0">
          {company.industry && (
            <span className="text-[11px] text-gray-400">{company.industry}</span>
          )}
          {company.industry && company.size && (
            <span className="text-gray-300">·</span>
          )}
          {company.size && (
            <span className="text-[11px] capitalize text-gray-400">{company.size}</span>
          )}
          {company.sponsors_h1b && (
            <>
              <span className="text-gray-300">·</span>
              <span className="text-[11px] font-semibold text-[#FF5C18]">H-1B</span>
            </>
          )}
        </div>
      </div>

      {/* Sponsor score */}
      <div className="hidden w-36 flex-shrink-0 sm:block">
        <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-gray-400">
          Sponsor score
        </p>
        <ConfidenceBar score={company.sponsorship_confidence} />
      </div>

      {/* Job count */}
      <div className="hidden w-24 flex-shrink-0 text-right sm:block">
        {company.job_count > 0 ? (
          <>
            <p className="text-sm font-semibold tabular-nums text-[#FF5C18]">
              {company.job_count.toLocaleString()}
            </p>
            <p className="text-[10px] text-gray-400">
              {(newJobsToday ?? 0) > 0 ? (
                <span className="font-semibold text-emerald-600">+{newJobsToday} today</span>
              ) : (
                "open roles"
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-300">—</p>
        )}
      </div>

      {/* Watch button */}
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          isWatching ? onUnwatch(company.id) : onWatch(company.id)
        }}
        aria-label={isWatching ? "Unwatch company" : "Watch company"}
        className={cn(
          "flex-shrink-0 rounded-xl border p-2 transition",
          isWatching
            ? "border-[#FF5C18]/25 bg-[#FFF1E8] text-[#FF5C18] shadow-[0_3px_10px_rgba(255,92,24,0.08)]"
            : "border-transparent bg-transparent text-gray-400 opacity-0 group-hover:opacity-100 hover:border-[#FF5C18]/30 hover:bg-[#FFF1E8] hover:text-[#FF5C18]"
        )}
      >
        <Bookmark className="h-3.5 w-3.5" fill={isWatching ? "currentColor" : "none"} />
      </button>
    </Link>
  )
}

export default function CompaniesPage() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { user }     = useAuth()
  const { addCompany, removeCompany, isWatching } = useWatchlist(user?.id)

  const [all,          setAll]          = useState<Company[]>([])
  const [industries,   setIndustries]   = useState<string[]>([])
  const [newToday,     setNewToday]     = useState<Record<string, number>>({})
  const [total,        setTotal]        = useState(0)
  const [isLoading,    setIsLoading]    = useState(true)
  const [offset,       setOffset]       = useState(0)
  const [industryOpen, setIndustryOpen] = useState(false)

  const selectedIndustries = useMemo(
    () => searchParams.get("industry")?.split(",").filter(Boolean) ?? [],
    [searchParams]
  )
  const selectedSizes = useMemo(
    () => (searchParams.get("size")?.split(",").filter(Boolean) ?? []) as CompanySize[],
    [searchParams]
  )
  const selectedAts = searchParams.get("ats") ?? ""
  const sponsorsH1b = searchParams.get("sponsors_h1b") === "1"
  const hasJobs     = searchParams.get("has_jobs") === "1"
  const sort        = searchParams.get("sort") ?? "job_count"
  const qParam      = searchParams.get("q") ?? ""
  const [searchDraft, setSearchDraft] = useState(qParam)

  useEffect(() => { setSearchDraft(qParam) }, [qParam])

  useEffect(() => {
    const trimmed = searchDraft.trim()
    if (trimmed === qParam.trim()) return
    const id = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams.toString())
      if (trimmed) next.set("q", trimmed)
      else next.delete("q")
      setOffset(0)
      router.replace(`?${next.toString()}`, { scroll: false })
    }, 350)
    return () => window.clearTimeout(id)
  }, [searchDraft, qParam, router, searchParams])

  function update(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    setOffset(0)
    router.replace(`?${next.toString()}`, { scroll: false })
  }

  function toggleList(key: string, current: string[], value: string) {
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    update(key, next.join(",") || null)
  }

  useEffect(() => {
    async function load() {
      setIsLoading(true)
      const params = new URLSearchParams({
        sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      })
      if (selectedIndustries.length) params.set("industry", selectedIndustries.join(","))
      if (selectedSizes.length) params.set("size", selectedSizes.join(","))
      if (selectedAts) params.set("ats_type", selectedAts)
      if (sponsorsH1b) params.set("sponsors_h1b", "true")
      if (hasJobs) params.set("has_jobs", "true")
      if (qParam.trim()) params.set("q", qParam.trim())

      const res = await fetch(`/api/companies?${params}`)
      if (res.ok) {
        const { companies: data, total: count } = (await res.json()) as {
          companies: Company[]
          total: number
        }
        if (offset === 0) setAll(data ?? [])
        else setAll((prev) => [...prev, ...(data ?? [])])
        setTotal(count ?? 0)
      }
      setIsLoading(false)
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndustries.join(","), selectedSizes.join(","), selectedAts, sponsorsH1b, hasJobs, sort, qParam, offset])

  useEffect(() => {
    async function loadIndustries() {
      const res = await fetch("/api/companies?limit=500&sort=name")
      if (!res.ok) return
      const { companies } = (await res.json()) as {
        companies: Array<{ industry: string | null }>
      }
      const unique = Array.from(
        new Set(companies.map((c) => c.industry).filter(Boolean))
      ).sort() as string[]
      setIndustries(unique)
    }
    void loadIndustries()
  }, [])

  useEffect(() => {
    async function loadNewToday() {
      const res = await fetch(`/api/jobs?within=24h&limit=500&offset=0`)
      if (!res.ok) return
      const { jobs } = (await res.json()) as { jobs: Array<{ company_id: string }> }
      const map: Record<string, number> = {}
      for (const row of jobs) {
        map[row.company_id] = (map[row.company_id] ?? 0) + 1
      }
      setNewToday(map)
    }
    void loadNewToday()
  }, [])

  const activeFilterCount =
    selectedIndustries.length +
    selectedSizes.length +
    (selectedAts ? 1 : 0) +
    (sponsorsH1b ? 1 : 0) +
    (hasJobs ? 1 : 0) +
    (qParam.trim() ? 1 : 0)

  return (
    <main
      className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]"
      onClick={() => industryOpen && setIndustryOpen(false)}
    >
      <div className="app-shell w-full space-y-4 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))]">

        {/* ── Page header ───────────────────────────────────── */}
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition hover:text-gray-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[#FFF1E8]">
                <Building2 className="h-5 w-5 text-[#FF5C18]" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-gray-900">
                  Company Explorer
                </h1>
                <p className="text-xs text-gray-400">
                  {total.toLocaleString()} companies
                  {activeFilterCount > 0 &&
                    ` · ${activeFilterCount} filter${activeFilterCount !== 1 ? "s" : ""} active`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="Search companies…"
                  autoComplete="off"
                  className="h-9 w-52 rounded-xl border border-gray-200 bg-white pl-8 pr-3 text-sm text-gray-900 outline-none placeholder:text-gray-400 transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FF5C18]/12 md:w-64"
                />
              </div>

              {/* Sort */}
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => update("sort", e.target.value)}
                  className="h-9 appearance-none rounded-xl border border-gray-200 bg-white pl-3 pr-8 text-sm font-medium text-gray-600 outline-none transition hover:border-gray-300 focus:border-[#FF5C18]"
                >
                  {SORT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            </div>
          </div>
        </div>

        {/* ── Filter strip ──────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {/* Industry dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIndustryOpen((v) => !v)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition",
                selectedIndustries.length > 0
                  ? "border-[#FF5C18]/40 bg-[#FFF1E8] text-[#FF5C18]"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              )}
            >
              Industry
              {selectedIndustries.length > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#FF5C18] text-[9px] font-bold text-white">
                  {selectedIndustries.length}
                </span>
              )}
              <ChevronDown className="h-3 w-3 opacity-50" />
            </button>
            {industryOpen && (
              <div className="absolute left-0 top-full z-30 mt-1.5 max-h-56 w-60 overflow-y-auto rounded-2xl border border-gray-200 bg-white py-1.5 shadow-[0_16px_48px_rgba(15,23,42,0.14)]">
                {industries.map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    onClick={() => toggleList("industry", selectedIndustries, ind)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3.5 py-2 text-sm transition hover:bg-gray-50",
                      selectedIndustries.includes(ind) ? "font-medium text-[#FF5C18]" : "text-gray-700"
                    )}
                  >
                    <span
                      className={cn(
                        "h-3.5 w-3.5 flex-shrink-0 rounded border transition",
                        selectedIndustries.includes(ind)
                          ? "border-[#FF5C18] bg-[#FF5C18]"
                          : "border-gray-300"
                      )}
                    />
                    {ind}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ATS select */}
          <div className="relative">
            <select
              value={selectedAts}
              onChange={(e) => update("ats", e.target.value || null)}
              className={cn(
                "h-8 appearance-none rounded-full border pl-3 pr-7 text-xs font-medium outline-none transition",
                selectedAts
                  ? "border-[#FF5C18]/40 bg-[#FFF1E8] text-[#FF5C18]"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              )}
            >
              <option value="">Any ATS</option>
              {ATS_OPTIONS.map((ats) => (
                <option key={ats} value={ats}>
                  {ats.charAt(0).toUpperCase() + ats.slice(1)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
          </div>

          <div className="h-5 w-px bg-gray-200" />

          {/* Size chips */}
          {SIZE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => toggleList("size", selectedSizes, o.value)}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition",
                selectedSizes.includes(o.value)
                  ? "border-[#FF5C18]/40 bg-[#FFF1E8] text-[#FF5C18]"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
              )}
            >
              {o.label}
            </button>
          ))}

          <div className="h-5 w-px bg-gray-200" />

          {/* Quick filters */}
          <button
            type="button"
            onClick={() => update("sponsors_h1b", sponsorsH1b ? null : "1")}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition",
              sponsorsH1b
                ? "border-[#FF5C18]/40 bg-[#FFF1E8] text-[#FF5C18]"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            )}
          >
            Sponsors H-1B
          </button>
          <button
            type="button"
            onClick={() => update("has_jobs", hasJobs ? null : "1")}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition",
              hasJobs
                ? "border-[#FF5C18]/40 bg-[#FFF1E8] text-[#FF5C18]"
                : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
            )}
          >
            Currently hiring
          </button>

          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => {
                router.replace("/dashboard/companies", { scroll: false })
                setOffset(0)
              }}
              className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-gray-400 transition hover:text-gray-700"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {/* ── Company list ──────────────────────────────────── */}
        {isLoading && all.length === 0 ? (
          <div className="surface-card overflow-hidden divide-y divide-gray-50">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-xl bg-gray-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-40 animate-pulse rounded-full bg-gray-100" />
                  <div className="h-2.5 w-24 animate-pulse rounded-full bg-gray-100" />
                </div>
                <div className="hidden h-3 w-32 animate-pulse rounded-full bg-gray-100 sm:block" />
                <div className="hidden h-3 w-14 animate-pulse rounded-full bg-gray-100 sm:block" />
              </div>
            ))}
          </div>
        ) : all.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
              <Building2 className="h-6 w-6 text-gray-400" />
            </div>
            <p className="font-semibold text-gray-700">No companies match your filters</p>
            <p className="text-sm text-gray-400">Try removing some filters above.</p>
          </div>
        ) : (
          <div className="surface-card overflow-hidden">
            {/* Column headers */}
            <div className="hidden items-center gap-4 border-b border-gray-100 px-5 py-2.5 sm:flex">
              <div className="w-9 flex-shrink-0" />
              <div className="flex-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Company
              </div>
              <div className="w-36 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Sponsor score
              </div>
              <div className="w-24 flex-shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                Open roles
              </div>
              <div className="w-8 flex-shrink-0" />
            </div>

            <div className="divide-y divide-gray-50">
              {all.map((company) => (
                <CompanyRow
                  key={company.id}
                  company={company}
                  newJobsToday={newToday[company.id]}
                  isWatching={isWatching(company.id)}
                  onWatch={(id) => void addCompany(id)}
                  onUnwatch={(id) => void removeCompany(id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Load more */}
        {!isLoading && all.length < total && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="rounded-2xl border border-gray-200 bg-white px-6 py-2.5 text-sm font-medium text-gray-600 shadow-sm transition hover:border-gray-300 hover:bg-gray-50"
            >
              Load {Math.min(PAGE_SIZE, total - all.length)} more
            </button>
          </div>
        )}

        <div aria-hidden className="h-[clamp(2rem,5vh,4rem)] shrink-0" />
      </div>
    </main>
  )
}
