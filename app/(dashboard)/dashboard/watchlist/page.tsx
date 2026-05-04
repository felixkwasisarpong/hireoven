"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  Bookmark,
  BookmarkX,
  Building2,
  ExternalLink,
  Plus,
  Search,
} from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { cn } from "@/lib/utils"
import type { Company } from "@/types"

type CompanyInsights = {
  newJobsThisWeek: number
  latestJobTitle: string | null
  latestJobDetectedAt: string | null
}

function formatRelativeDate(ts?: string | null) {
  if (!ts) return null
  const m = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 60_000))
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function ActivityPulse({ count, loading }: { count: number; loading: boolean }) {
  if (loading)
    return <div className="h-4 w-20 animate-pulse rounded-full bg-gray-100" />
  if (count === 0)
    return <span className="text-[11px] text-gray-400">Quiet this week</span>
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        count >= 10
          ? "bg-emerald-50 text-emerald-700"
          : count >= 3
            ? "bg-[#FFF1E8] text-[#FF5C18]"
            : "bg-gray-100 text-gray-600"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          count >= 10 ? "bg-emerald-500" : count >= 3 ? "bg-[#FF5C18]" : "bg-gray-400"
        )}
      />
      {count} new this week
    </span>
  )
}

function H1BBar({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score))
  const color =
    pct >= 80
      ? "bg-emerald-500"
      : pct >= 60
        ? "bg-[#FF5C18]"
        : pct >= 40
          ? "bg-amber-400"
          : "bg-gray-200"
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
        <div
          className={cn("h-full rounded-full transition-all duration-500", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-7 flex-shrink-0 text-right text-[10px] font-semibold tabular-nums text-gray-500">
        {pct}%
      </span>
    </div>
  )
}

export default function WatchlistPage() {
  const { user } = useAuth()
  const { watchlist, isLoading, addCompany, removeCompany, isWatching } =
    useWatchlist(user?.id)
  const [query, setQuery] = useState("")
  const [discoverCompanies, setDiscoverCompanies] = useState<Company[]>([])
  const [insights, setInsights] = useState<Record<string, CompanyInsights>>({})
  const [insightsLoading, setInsightsLoading] = useState(false)

  useEffect(() => {
    async function fetchSuggestions() {
      const params = new URLSearchParams({
        sort: "job_count",
        limit: "8",
        has_jobs: "true",
      })
      if (query.trim()) params.set("q", query.trim())
      const res = await fetch(`/api/companies?${params}`, { cache: "no-store" })
      if (res.ok) {
        const body = (await res.json()) as { companies?: Company[] }
        setDiscoverCompanies(body.companies ?? [])
      }
    }
    const t = window.setTimeout(() => void fetchSuggestions(), 200)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    async function fetchInsights() {
      if (!watchlist.length) {
        setInsights({})
        return
      }
      setInsightsLoading(true)
      const pairs = await Promise.all(
        watchlist.map(async (item) => {
          const params = new URLSearchParams({
            company_id: item.company_id,
            within: "7d",
            limit: "1",
            offset: "0",
          })
          const res = await fetch(`/api/jobs?${params}`, { cache: "no-store" })
          const body = res.ok
            ? ((await res.json()) as {
                jobs?: Array<{ title?: string; first_detected_at?: string }>
                total?: number
              })
            : { jobs: [], total: 0 }
          const latest = body.jobs?.[0]
          return [
            item.company_id,
            {
              newJobsThisWeek: body.total ?? 0,
              latestJobTitle: latest?.title ?? null,
              latestJobDetectedAt: latest?.first_detected_at ?? null,
            },
          ] as const
        })
      )
      setInsights(Object.fromEntries(pairs))
      setInsightsLoading(false)
    }
    void fetchInsights()
  }, [watchlist])

  const filteredSuggestions = useMemo(
    () => discoverCompanies.filter((c) => !isWatching(c.id)),
    [discoverCompanies, isWatching]
  )

  return (
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">
      <div className="app-shell w-full space-y-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))]">

        {/* ── Page header ───────────────────────────────────── */}
        <div>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-gray-400 transition hover:text-gray-700"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>

          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-blue-50">
              <Bookmark className="h-5 w-5 text-blue-600" fill="currentColor" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-gray-900">
                Watchlist
              </h1>
              <p className="text-xs text-gray-400">
                {isLoading
                  ? "Loading…"
                  : watchlist.length === 0
                    ? "No companies tracked yet"
                    : `${watchlist.length} compan${watchlist.length === 1 ? "y" : "ies"} tracked`}
              </p>
            </div>
          </div>
        </div>

        {/* ── Two-column body ───────────────────────────────── */}
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">

          {/* ── Watched companies ── */}
          <div>
            {isLoading ? (
              <div className="surface-card divide-y divide-gray-50 overflow-hidden">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-xl bg-gray-100" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-36 animate-pulse rounded-full bg-gray-100" />
                      <div className="h-2.5 w-24 animate-pulse rounded-full bg-gray-100" />
                    </div>
                    <div className="hidden h-3 w-24 animate-pulse rounded-full bg-gray-100 sm:block" />
                    <div className="hidden h-3 w-32 animate-pulse rounded-full bg-gray-100 sm:block" />
                  </div>
                ))}
              </div>
            ) : watchlist.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-gray-200 bg-gray-50/30 py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
                  <Bookmark className="h-7 w-7 text-blue-300" />
                </div>
                <div>
                  <p className="font-semibold text-gray-700">Nothing tracked yet</p>
                  <p className="mt-1 text-sm text-gray-400">
                    Use the panel on the right to start adding companies
                  </p>
                </div>
                <Link
                  href="/dashboard/companies"
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm transition hover:bg-gray-50"
                >
                  <Building2 className="h-4 w-4" />
                  Browse all companies
                </Link>
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
                    Activity
                  </div>
                  <div className="w-44 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                    Latest role
                  </div>
                  <div className="w-28 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">
                    H-1B score
                  </div>
                  <div className="w-14 flex-shrink-0" />
                </div>

                <div className="divide-y divide-gray-50">
                  {watchlist.map((item) => {
                    const company = item.company
                    const ins = insights[item.company_id]
                    const confidence = Math.max(
                      0,
                      Math.min(100, company.sponsorship_confidence ?? 0)
                    )
                    const relTime = formatRelativeDate(ins?.latestJobDetectedAt)

                    return (
                      <div
                        key={item.id}
                        className="group flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-gray-50/70"
                      >
                        {/* Logo */}
                        <CompanyLogo
                          companyName={company.name}
                          domain={company.domain}
                          logoUrl={company.logo_url}
                          className="h-9 w-9 flex-shrink-0 rounded-xl border border-slate-100 bg-white object-contain p-1 shadow-[0_3px_8px_rgba(15,23,42,0.04)]"
                        />

                        {/* Name */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-gray-900">
                            {company.name}
                          </p>
                          <p className="truncate text-[11px] text-gray-400">
                            {company.industry || company.domain}
                          </p>
                        </div>

                        {/* Activity */}
                        <div className="hidden w-36 flex-shrink-0 sm:block">
                          <ActivityPulse
                            count={ins?.newJobsThisWeek ?? 0}
                            loading={insightsLoading && !ins}
                          />
                        </div>

                        {/* Latest role */}
                        <div className="hidden w-44 flex-shrink-0 sm:block">
                          {insightsLoading && !ins ? (
                            <div className="space-y-1.5">
                              <div className="h-2.5 w-36 animate-pulse rounded-full bg-gray-100" />
                              <div className="h-2 w-20 animate-pulse rounded-full bg-gray-100" />
                            </div>
                          ) : ins?.latestJobTitle ? (
                            <div>
                              <p className="truncate text-[11px] font-medium text-gray-700">
                                {ins.latestJobTitle}
                              </p>
                              {relTime && (
                                <p className="text-[10px] text-gray-400">{relTime}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-gray-400">No recent posts</span>
                          )}
                        </div>

                        {/* H1B score */}
                        <div className="hidden w-28 flex-shrink-0 sm:block">
                          <H1BBar score={confidence} />
                        </div>

                        {/* Actions */}
                        <div className="flex w-14 flex-shrink-0 items-center justify-end gap-0.5">
                          <Link
                            href={`/dashboard/companies/${item.company_id}`}
                            title="View company"
                            className="rounded-lg p-1.5 text-gray-400 opacity-0 transition group-hover:opacity-100 hover:bg-gray-100 hover:text-gray-700"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Link>
                          <button
                            type="button"
                            onClick={() => void removeCompany(item.company_id)}
                            title="Remove from watchlist"
                            className="rounded-lg p-1.5 text-gray-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-500"
                          >
                            <BookmarkX className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Discovery panel ── */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <div className="surface-card overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-4">
                <p className="text-sm font-semibold text-gray-900">Add companies</p>
                <p className="mt-0.5 text-xs text-gray-400">
                  Search and track companies you care about
                </p>
              </div>

              {/* Search */}
              <div className="px-4 pt-3 pb-1">
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5">
                  <Search className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search companies…"
                    className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                  />
                </div>
              </div>

              {/* Suggestions */}
              <div className="divide-y divide-gray-50 pb-1">
                {filteredSuggestions.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-gray-400">
                    {query.trim() ? "No companies found" : "All top companies already added!"}
                  </p>
                ) : (
                  filteredSuggestions.slice(0, 7).map((company) => (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => void addCompany(company.id)}
                      className="group flex w-full items-center gap-3 px-4 py-3 transition hover:bg-gray-50/70"
                    >
                      <CompanyLogo
                        companyName={company.name}
                        domain={company.domain}
                        logoUrl={company.logo_url}
                        className="h-8 w-8 flex-shrink-0 rounded-xl border border-gray-100 bg-white object-contain p-0.5"
                      />
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium text-gray-800">
                          {company.name}
                        </p>
                        <p className="truncate text-[11px] text-gray-400">
                          {company.job_count > 0
                            ? `${company.job_count.toLocaleString()} open roles`
                            : company.industry || "Company"}
                        </p>
                      </div>
                      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-400 transition group-hover:border-blue-200 group-hover:bg-blue-50 group-hover:text-blue-600">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="border-t border-gray-100 px-4 py-3">
                <Link
                  href="/dashboard/companies"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 transition hover:text-gray-900"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Browse all companies
                </Link>
              </div>
            </div>
          </div>
        </div>

        <div aria-hidden className="h-[clamp(2rem,5vh,4rem)] shrink-0" />
      </div>
    </main>
  )
}
