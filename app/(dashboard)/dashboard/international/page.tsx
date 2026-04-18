"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Globe2, Search } from "lucide-react"
import CompanyH1BCard from "@/components/international/CompanyH1BCard"
import OPTCountdown from "@/components/international/OPTCountdown"
import SponsorshipScore from "@/components/international/SponsorshipScore"
import JobFeed from "@/components/jobs/JobFeed"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { createClient } from "@/lib/supabase/client"
import type { Company, JobFilters } from "@/types"

const SPONSORSHIP_FEED_FILTERS: JobFilters = { sponsorship: true, sort: "freshest" }

type IndustryBar = { industry: string; petitions: number }

export default function InternationalPage() {
  const { user, profile } = useAuth()
  const { watchlist, addCompany, removeCompany, isWatching } = useWatchlist(user?.id)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyQuery, setCompanyQuery] = useState("")
  const [industryBars, setIndustryBars] = useState<IndustryBar[]>([])

  const isOptUser =
    profile?.is_international &&
    (profile.visa_status === "opt" || profile.visa_status === "stem_opt")

  useEffect(() => {
    async function fetchCompanies() {
      const supabase = createClient()
      const { data } = await supabase
        .from("companies")
        .select("*")
        .eq("is_active", true)
        .eq("sponsors_h1b", true)
        .order("h1b_sponsor_count_1yr", { ascending: false })
        .limit(60)

      setCompanies((data ?? []) as Company[])

      // Aggregate petitions by industry
      const map = new Map<string, number>()
      for (const company of (data ?? []) as Company[]) {
        const industry = company.industry ?? "Other"
        map.set(industry, (map.get(industry) ?? 0) + company.h1b_sponsor_count_1yr)
      }
      const sorted = Array.from(map.entries())
        .map(([industry, petitions]) => ({ industry, petitions }))
        .sort((a, b) => b.petitions - a.petitions)
        .slice(0, 8)
      setIndustryBars(sorted)
    }

    void fetchCompanies()
  }, [])

  const filteredCompanies = useMemo(() => {
    if (!companyQuery.trim()) return companies
    const q = companyQuery.trim().toLowerCase()
    return companies.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.industry ?? "").toLowerCase().includes(q)
    )
  }, [companies, companyQuery])

  const maxPetitions = industryBars[0]?.petitions ?? 1

  return (
    <main className="app-page">
      <div className="app-shell max-w-7xl space-y-8">

        {/* ── Hero header ── */}
        <section className="surface-hero">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-[#FFF7F2]">
                  <Globe2 className="h-5 w-5 text-[#FF5C18]" />
                </div>
                <p className="section-kicker">International Hub</p>
              </div>
              <h1 className="section-title">
                Built for international candidates
              </h1>
              <p className="section-copy mt-3 max-w-2xl">
                Every company here has sponsored H-1B visas. Use USCIS petition data,
                not guesswork, to decide where to spend your time.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              Back to feed
            </Link>
          </div>
        </section>

        {/* ── OPT Command Center ── */}
        {isOptUser && (
          <section>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-400">
              OPT Command Center
            </p>
            <div className="surface-card p-6">
              <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-1">
                    Your countdown
                  </h2>
                  <p className="text-sm text-gray-500 mb-5">
                    Track your remaining OPT time and prioritize your search accordingly.
                  </p>
                  <OPTCountdown
                    optEndDate={profile?.opt_end_date ?? null}
                    visaStatus={profile?.visa_status ?? null}
                  />
                </div>
                <div className="space-y-4">
                  <div className="surface-card-subtle p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400 mb-3">
                      Quick actions
                    </p>
                    <div className="space-y-2">
                      <Link
                        href="/dashboard/international#companies"
                        className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-[#FFD2B8] hover:text-[#062246]"
                      >
                        Browse sponsor-friendly companies
                        <span className="text-gray-400">→</span>
                      </Link>
                      <Link
                        href="/dashboard/alerts"
                        className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-[#FFD2B8] hover:text-[#062246]"
                      >
                        Set up sponsorship alerts
                        <span className="text-gray-400">→</span>
                      </Link>
                      <Link
                        href="/dashboard/onboarding"
                        className="flex items-center justify-between rounded-xl bg-white border border-gray-200 px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-[#FFD2B8] hover:text-[#062246]"
                      >
                        Update OPT end date
                        <span className="text-gray-400">→</span>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Sponsorship Intel Feed ── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-400">
              Sponsorship Intel Feed
            </p>
            <span className="rounded-full bg-[#FFF7F2] px-3 py-1 text-xs font-semibold text-[#062246]">
              H-1B friendly only
            </span>
          </div>
          <div className="surface-card p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-1">
              Fresh roles at sponsors
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              Every role below comes from a company that has filed H-1B petitions.
            </p>
            <JobFeed filters={SPONSORSHIP_FEED_FILTERS} searchQuery="" />
          </div>
        </section>

        {/* ── Company Explorer ── */}
        <section id="companies">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-400">
            Company Explorer
          </p>
          <div className="surface-card p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
              <div>
                <h2 className="text-xl font-semibold text-gray-900 mb-1">
                  H-1B sponsoring companies
                </h2>
                <p className="text-sm text-gray-500">
                  Ranked by petition volume — {companies.length} companies tracked
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-[#F8FBFF] px-4 py-3 sm:w-72">
                <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <input
                  value={companyQuery}
                  onChange={(e) => setCompanyQuery(e.target.value)}
                  placeholder="Search companies…"
                  className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                />
              </div>
            </div>

            {filteredCompanies.length === 0 ? (
              <div className="empty-state px-6 py-10 text-sm text-gray-500 shadow-none">
                No companies match &ldquo;{companyQuery}&rdquo;
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredCompanies.slice(0, 30).map((company) => (
                  <CompanyH1BCard
                    key={company.id}
                    company={company}
                    isWatching={isWatching(company.id)}
                    onWatch={(id) => void addCompany(id)}
                    onUnwatch={(id) => void removeCompany(id)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── H1B Insights ── */}
        <section>
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-400">
            H-1B Insights
          </p>
          <div className="surface-card p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-1">
              Sponsorship by industry
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              Total H-1B petitions filed in the last year, grouped by industry.
            </p>

            {industryBars.length === 0 ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded-xl bg-gray-100" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {industryBars.map(({ industry, petitions }) => {
                  const pct = Math.max(4, Math.round((petitions / maxPetitions) * 100))
                  return (
                    <div key={industry} className="flex items-center gap-4">
                      <p className="w-44 flex-shrink-0 truncate text-sm text-gray-700">
                        {industry}
                      </p>
                      <div className="flex flex-1 items-center gap-3">
                        <div className="flex-1 h-8 rounded-xl bg-gray-100 overflow-hidden">
                          <div
                            className="h-full rounded-xl bg-gradient-to-r from-[#062246] to-[#FF5C18] transition-all duration-700"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="w-16 text-right text-sm font-semibold tabular-nums text-gray-900">
                          {petitions.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <p className="mt-4 text-xs text-gray-400">
              Based on USCIS H-1B petition data imported into Hireoven. Updates when new data is loaded.
            </p>
          </div>
        </section>

      </div>
    </main>
  )
}
