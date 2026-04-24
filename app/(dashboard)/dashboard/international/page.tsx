"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Search } from "lucide-react"
import CompanyH1BCard from "@/components/international/CompanyH1BCard"
import OPTCountdown from "@/components/international/OPTCountdown"
import DashboardPageHeader from "@/components/layout/DashboardPageHeader"
import JobFeed from "@/components/jobs/JobFeed"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
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
      const params = new URLSearchParams({
        sponsors_h1b: "true",
        limit: "60",
        sort: "h1b_sponsor_count_1yr",
      })
      const res = await fetch(`/api/companies?${params}`, { cache: "no-store" })
      if (!res.ok) {
        setCompanies([])
        setIndustryBars([])
        return
      }
      const body = (await res.json()) as { companies?: Company[] }
      const data = body.companies ?? []
      setCompanies(data as Company[])

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
        <DashboardPageHeader
          kicker="International Hub"
          title="Built for international candidates"
          description="Every company here has sponsored H-1B visas. Use USCIS petition data, not guesswork, to decide where to spend your time."
          backHref="/dashboard"
          backLabel="Back to feed"
          meta={
            <span className="inline-flex items-center rounded-full border border-border bg-brand-tint px-3 py-1 text-xs font-semibold text-brand-navy">
              H-1B friendly only
            </span>
          }
        />

        {/* ── OPT Command Center ── */}
        {isOptUser && (
          <section>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
              OPT Command Center
            </p>
            <div className="surface-card p-6">
              <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
                <div>
                  <h2 className="text-xl font-semibold text-strong mb-1">
                    Your countdown
                  </h2>
                  <p className="text-sm text-muted-foreground mb-5">
                    Track your remaining OPT time and prioritize your search accordingly.
                  </p>
                  <OPTCountdown
                    optEndDate={profile?.opt_end_date ?? null}
                    visaStatus={profile?.visa_status ?? null}
                  />
                </div>
                <div className="space-y-4">
                  <div className="surface-card-subtle p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground mb-3">
                      Quick actions
                    </p>
                    <div className="space-y-2">
                      <Link
                        href="/dashboard/international#companies"
                        className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-strong transition hover:border-[hsl(var(--accent-soft-border))] hover:bg-brand-tint"
                      >
                        Browse sponsor-friendly companies
                        <span className="text-muted-foreground">→</span>
                      </Link>
                      <Link
                        href="/dashboard/alerts"
                        className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-strong transition hover:border-[hsl(var(--accent-soft-border))] hover:bg-brand-tint"
                      >
                        Set up sponsorship alerts
                        <span className="text-muted-foreground">→</span>
                      </Link>
                      <Link
                        href="/dashboard/international/h1b-explorer"
                        className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-strong transition hover:border-[hsl(var(--accent-soft-border))] hover:bg-brand-tint"
                      >
                        Search the DOL LCA database
                        <span className="text-muted-foreground">→</span>
                      </Link>
                      <Link
                        href="/dashboard/onboarding"
                        className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium text-strong transition hover:border-[hsl(var(--accent-soft-border))] hover:bg-brand-tint"
                      >
                        Update OPT end date
                        <span className="text-muted-foreground">→</span>
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
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Sponsorship Intel Feed
          </p>
          <div className="surface-card overflow-hidden p-6">
            <h2 className="text-xl font-semibold text-strong mb-1">
              Fresh roles at sponsors
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Every role below comes from a company that has filed H-1B petitions.
            </p>
            <JobFeed filters={SPONSORSHIP_FEED_FILTERS} searchQuery="" />
          </div>
        </section>

        {/* ── Company Explorer ── */}
        <section id="companies">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Company Explorer
          </p>
          <div className="surface-card rounded-lg px-5 py-5 md:px-6 md:py-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-strong mb-1">
                  H-1B sponsoring companies
                </h2>
                <p className="text-sm text-muted-foreground">
                  Ranked by petition volume - {companies.length} companies tracked
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface-alt px-4 py-3 sm:w-72">
                <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                <input
                  value={companyQuery}
                  onChange={(e) => setCompanyQuery(e.target.value)}
                  placeholder="Search companies…"
                  className="w-full bg-transparent text-sm text-strong outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {filteredCompanies.length === 0 ? (
              <div className="empty-state px-6 py-10 text-sm text-muted-foreground shadow-none">
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
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            H-1B Insights
          </p>
          <div className="surface-card p-6">
            <h2 className="text-xl font-semibold text-strong mb-1">
              Sponsorship by industry
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              Total H-1B petitions filed in the last year, grouped by industry.
            </p>

            {industryBars.length === 0 ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded-xl bg-surface-muted" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {industryBars.map(({ industry, petitions }) => {
                  const pct = Math.max(4, Math.round((petitions / maxPetitions) * 100))
                  return (
                    <div key={industry} className="flex items-center gap-4">
                      <p className="w-44 flex-shrink-0 truncate text-sm text-strong">
                        {industry}
                      </p>
                      <div className="flex flex-1 items-center gap-3">
                        <div className="h-8 flex-1 overflow-hidden rounded-xl bg-surface-muted">
                          <div
                            className="h-full rounded-xl bg-gradient-to-r from-[#062246] to-[#FF5C18] transition-all duration-700"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="w-16 text-right text-sm font-semibold tabular-nums text-strong">
                          {petitions.toLocaleString()}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <p className="mt-4 text-xs text-muted-foreground">
              Based on USCIS H-1B petition data imported into Hireoven. Updates when new data is loaded.
            </p>
          </div>
        </section>

      </div>
    </main>
  )
}
