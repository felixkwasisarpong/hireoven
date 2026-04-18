"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { BookmarkMinus, Plus, Search, Sparkles } from "lucide-react"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { createClient } from "@/lib/supabase/client"
import type { Company } from "@/types"

type CompanyInsights = {
  newJobsThisWeek: number
  latestJobTitle: string | null
  latestJobDetectedAt: string | null
}

function formatRelativeDate(timestamp?: string | null) {
  if (!timestamp) return "No recent postings"

  const minutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(timestamp).getTime()) / 60_000)
  )
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export default function WatchlistPage() {
  const { user, profile } = useAuth()
  const { watchlist, isLoading, addCompany, removeCompany, isWatching } = useWatchlist(
    user?.id
  )
  const [query, setQuery] = useState("")
  const [discoverCompanies, setDiscoverCompanies] = useState<Company[]>([])
  const [insights, setInsights] = useState<Record<string, CompanyInsights>>({})

  useEffect(() => {
    async function fetchDiscoverCompanies() {
      const supabase = createClient()
      let request = supabase
        .from("companies")
        .select("*")
        .eq("is_active", true)
        .order("job_count", { ascending: false })
        .limit(8)

      if (query.trim()) {
        request = request.ilike("name", `%${query.trim()}%`)
      }

      const { data } = await request
      setDiscoverCompanies((data as Company[]) ?? [])
    }

    const timeout = window.setTimeout(() => {
      void fetchDiscoverCompanies()
    }, 200)

    return () => window.clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    async function fetchInsights() {
      if (!watchlist.length) {
        setInsights({})
        return
      }

      const supabase = createClient()
      const weekStart = new Date()
      weekStart.setDate(weekStart.getDate() - 7)

      const pairs = await Promise.all(
        watchlist.map(async (item) => {
          const [{ count }, { data: latestJob }] = await Promise.all([
            supabase
              .from("jobs")
              .select("*", { head: true, count: "exact" })
              .eq("company_id", item.company_id)
              .eq("is_active", true)
              .gte("first_detected_at", weekStart.toISOString()),
            supabase
              .from("jobs")
              .select("title, first_detected_at")
              .eq("company_id", item.company_id)
              .eq("is_active", true)
              .order("first_detected_at", { ascending: false })
              .limit(1)
              .maybeSingle(),
          ])

          return [
            item.company_id,
            {
              newJobsThisWeek: count ?? 0,
              latestJobTitle: (latestJob as any)?.title ?? null,
              latestJobDetectedAt: (latestJob as any)?.first_detected_at ?? null,
            },
          ] as const
        })
      )

      setInsights(Object.fromEntries(pairs))
    }

    void fetchInsights()
  }, [watchlist])

  const filteredSuggestions = useMemo(
    () => discoverCompanies.filter((company) => !isWatching(company.id)),
    [discoverCompanies, isWatching]
  )

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_58%,#F8FAFC_100%)] px-4 py-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#0369A1]">
                Watchlist
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
                Companies worth stalking closely
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
                Track the employers you care about, see who is posting now, and
                remove friction when something fresh lands.
              </p>
            </div>

            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              Back to feed
            </Link>
          </div>

          <div className="mt-6 rounded-[28px] border border-gray-200 bg-[#F8FBFF] p-4">
            <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search and add more companies…"
                className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {filteredSuggestions.slice(0, 6).map((company) => (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => void addCompany(company.id)}
                  className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-[#BAE6FD] hover:bg-[#FCFEFE]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {company.logo_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={company.logo_url}
                        alt={company.name}
                        className="h-10 w-10 rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#E0F2FE] text-sm font-semibold text-[#0C4A6E]">
                        {company.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">
                        {company.name}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {company.industry || "Hiring company"}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[#F0F9FF] text-[#0369A1]">
                    <Plus className="h-4 w-4" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {watchlist.length === 0 && !isLoading ? (
          <section className="rounded-[32px] border border-dashed border-gray-300 bg-white px-6 py-14 text-center shadow-[0_20px_60px_rgba(15,23,42,0.04)]">
            <Sparkles className="mx-auto h-10 w-10 text-[#0369A1]" />
            <h2 className="mt-4 text-2xl font-semibold text-gray-900">
              Your watchlist is empty
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-gray-500">
              Add companies you want to monitor closely and Hireoven will keep the
              newest openings within reach.
            </p>
          </section>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {watchlist.map((item) => {
              const company = item.company
              const companyInsights = insights[item.company_id]
              const confidence = Math.max(
                0,
                Math.min(100, company.sponsorship_confidence ?? 0)
              )

              return (
                <article
                  key={item.id}
                  className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      {company.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={company.logo_url}
                          alt={company.name}
                          className="h-12 w-12 rounded-2xl object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E0F2FE] text-sm font-semibold text-[#0C4A6E]">
                          {company.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-lg font-semibold text-gray-900">
                          {company.name}
                        </p>
                        <p className="truncate text-sm text-gray-500">
                          {company.industry || "Industry not set"}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void removeCompany(item.company_id)}
                      className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                    >
                      <BookmarkMinus className="h-4 w-4" />
                      Remove
                    </button>
                  </div>

                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl bg-[#F8FBFF] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                        This week
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-gray-900">
                        {(companyInsights?.newJobsThisWeek ?? 0).toLocaleString()}
                      </p>
                      <p className="text-sm text-gray-500">new jobs this week</p>
                    </div>

                    <div className="rounded-2xl bg-[#F8FBFF] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                        Latest post
                      </p>
                      <p className="mt-2 text-sm font-semibold text-gray-900">
                        {companyInsights?.latestJobTitle || "No live jobs yet"}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">
                        {formatRelativeDate(companyInsights?.latestJobDetectedAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-gray-100 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">
                        H1B sponsorship confidence
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {confidence}%
                      </p>
                    </div>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#0C4A6E] via-[#0369A1] to-[#7DD3FC]"
                        style={{ width: `${confidence}%` }}
                      />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-gray-500">
                      {company.sponsors_h1b
                        ? "This company already shows strong sponsorship signals."
                        : "Confidence is inferred from past hiring and sponsor signals."}
                    </p>
                  </div>
                </article>
              )
            })}
          </section>
        )}
      </div>
    </main>
  )
}
