"use client"

import { useCallback, useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, X } from "lucide-react"
import {
  filtersToSearchParams,
  parseJobFilters,
} from "@/components/jobs/JobFilters"
import { getSearchQuery, searchQueryToParams } from "@/components/jobs/JobSearch"
import { cn } from "@/lib/utils"

/** Header search on `/dashboard`: single rounded-full pill with just an icon + input (mock has no submit button). */
export default function DashboardFeedSearch({ className }: { className?: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchQuery = getSearchQuery(searchParams)
  const [draft, setDraft] = useState(searchQuery)

  const isFeed = pathname === "/dashboard"

  const commitToUrl = useCallback(() => {
    if (isFeed) {
      if (draft === searchQuery) return
      const filters = parseJobFilters(searchParams)
      const next = searchQueryToParams(
        filtersToSearchParams(searchParams, filters),
        draft
      )
      const value = next.toString()
      router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false })
      return
    }
    const trimmed = draft.trim()
    router.push(trimmed ? `/dashboard?q=${encodeURIComponent(trimmed)}` : "/dashboard")
  }, [draft, isFeed, pathname, router, searchParams, searchQuery])

  useEffect(() => {
    if (isFeed) setDraft(searchQuery)
  }, [searchQuery, isFeed])

  useEffect(() => {
    if (!isFeed) return
    const t = setTimeout(() => {
      if (draft === searchQuery) return
      const filters = parseJobFilters(searchParams)
      const next = searchQueryToParams(
        filtersToSearchParams(searchParams, filters),
        draft
      )
      const value = next.toString()
      router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false })
    }, 300)
    return () => clearTimeout(t)
  }, [draft, isFeed]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label
      className={cn(
        "relative flex h-10 w-full max-w-[520px] items-center rounded-full border border-slate-200 bg-white",
        className
      )}
    >
      <Search className="pointer-events-none absolute left-4 h-4 w-4 text-slate-400" aria-hidden />
      <input
        id="dashboard-feed-q"
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            commitToUrl()
          }
        }}
        placeholder="Search jobs, titles or companies"
        className="h-full w-full min-w-0 flex-1 rounded-full border-0 bg-transparent pl-11 pr-10 text-[14px] text-slate-800 outline-none placeholder:text-slate-400"
        autoComplete="off"
      />
      {draft ? (
        <button
          type="button"
          onClick={() => setDraft("")}
          className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </label>
  )
}
