"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  Clock3,
  Database,
  Plane,
  Search,
  ShieldAlert,
} from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import OPTCountdown from "@/components/international/OPTCountdown"
import SponsorshipScore from "@/components/international/SponsorshipScore"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { cn } from "@/lib/utils"
import type { Company } from "@/types"

const TOOLS = [
  {
    href: "/dashboard/international/opt-dashboard",
    title: "OPT Survival",
    copy: "Timeline, unemployment days, weekly target",
    icon: Clock3,
    accent: "bg-indigo-50 text-indigo-600 ring-indigo-100",
    hover: "hover:border-indigo-200 hover:bg-indigo-50/40",
  },
  {
    href: "/dashboard/international/offer-risk",
    title: "Offer Risk",
    copy: "Check salary, timing & sponsorship language",
    icon: ShieldAlert,
    accent: "bg-amber-50 text-amber-600 ring-amber-100",
    hover: "hover:border-amber-200 hover:bg-amber-50/40",
  },
  {
    href: "/dashboard/international/h1b-explorer",
    title: "LCA Explorer",
    copy: "Search DOL filings and employer history",
    icon: Database,
    accent: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    hover: "hover:border-emerald-200 hover:bg-emerald-50/40",
  },
]

export default function InternationalPage() {
  const { user, profile } = useAuth()
  const { addCompany, removeCompany, isWatching } = useWatchlist(user?.id)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyQuery, setCompanyQuery] = useState("")

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
      if (!res.ok) { setCompanies([]); return }
      const body = (await res.json()) as { companies?: Company[] }
      setCompanies((body.companies ?? []) as Company[])
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

  return (
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">
      <div className="app-shell max-w-[88rem] space-y-5 pb-[max(2rem,calc(env(safe-area-inset-bottom)+1rem))]">

        {/* ── Hero header ───────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl bg-slate-950 px-6 py-7 sm:px-8 sm:py-8">
          {/* Subtle glow blobs */}
          <div className="pointer-events-none absolute right-[-60px] top-[-60px] h-72 w-72 rounded-full bg-indigo-600/20 blur-3xl" />
          <div className="pointer-events-none absolute bottom-[-80px] left-[30%] h-56 w-56 rounded-full bg-orange-500/15 blur-3xl" />

          <div className="relative grid gap-8 lg:grid-cols-[1fr_340px] lg:items-start">
            <div>
              <Link
                href="/dashboard"
                className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-[11px] font-semibold text-white/60 transition hover:border-white/20 hover:text-white/80"
              >
                ← Dashboard
              </Link>

              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/10">
                  <Plane className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-indigo-400">
                    International Hub
                  </p>
                  <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                    Sponsorship command center
                  </h1>
                </div>
              </div>

              <p className="mt-3 max-w-xl text-sm leading-6 text-white/55">
                Track OPT urgency, review offer risk, discover sponsor-friendly companies,
                and scan fresh roles — all in one place.
              </p>

              {/* Tool tiles */}
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {TOOLS.map((tool) => {
                  const Icon = tool.icon
                  return (
                    <Link
                      key={tool.href}
                      href={tool.href}
                      className={cn(
                        "group flex items-start gap-3 rounded-xl border border-white/10 bg-white/6 p-4 transition",
                        "hover:border-white/20 hover:bg-white/10"
                      )}
                    >
                      <span className={cn(
                        "mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1",
                        tool.accent
                      )}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-white">{tool.title}</p>
                          <ArrowUpRight className="h-3.5 w-3.5 text-white/30 transition group-hover:text-white/70" />
                        </div>
                        <p className="mt-0.5 text-[11px] leading-4 text-white/45">{tool.copy}</p>
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>

            {/* OPT countdown (right column) */}
            <div className="lg:mt-8">
              {isOptUser ? (
                <div className="rounded-xl border border-white/10 bg-white/5 p-5">
                  <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">
                    Your countdown
                  </p>
                  <OPTCountdown
                    optEndDate={profile?.opt_end_date ?? null}
                    visaStatus={profile?.visa_status ?? null}
                  />
                </div>
              ) : (
                <div className="flex h-full min-h-[120px] items-center rounded-xl border border-white/10 bg-white/5 p-5">
                  <div>
                    <p className="text-sm font-semibold text-white/80">
                      Built for visa-aware search
                    </p>
                    <p className="mt-1.5 text-xs leading-5 text-white/45">
                      Use the tools above even if your current status is not OPT/STEM.
                      The sponsorship data applies to everyone.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── H-1B Sponsor Leaderboard ───────────────────────── */}
        <div className="surface-card overflow-hidden">
          {/* Section header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-500">
                H-1B Sponsors
              </p>
              <h2 className="mt-0.5 text-base font-semibold text-gray-900">
                Top sponsoring companies
              </h2>
              <p className="mt-0.5 text-xs text-gray-400">
                {companies.length} companies · ranked by petition volume
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2 sm:w-64">
              <Search className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
              <input
                value={companyQuery}
                onChange={(e) => setCompanyQuery(e.target.value)}
                placeholder="Search companies…"
                className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
              />
            </div>
          </div>

          {/* Column headers */}
          <div className="hidden items-center gap-4 border-b border-gray-100 bg-gray-50/40 px-6 py-2.5 sm:flex">
            <div className="w-8 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">#</div>
            <div className="flex-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Company</div>
            <div className="w-36 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">H-1B petitions</div>
            <div className="w-36 flex-shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Score</div>
            <div className="w-16 flex-shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-400">Roles</div>
            <div className="w-20 flex-shrink-0" />
          </div>

          {/* Rows */}
          {filteredCompanies.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">
              No companies match &ldquo;{companyQuery}&rdquo;
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filteredCompanies.slice(0, 30).map((company, index) => {
                const watching = isWatching(company.id)
                return (
                  <div
                    key={company.id}
                    className="group flex items-center gap-4 px-6 py-3.5 transition-colors hover:bg-indigo-50/25"
                  >
                    {/* Rank */}
                    <div className="w-8 flex-shrink-0 text-[11px] font-bold tabular-nums text-gray-300">
                      {index + 1}
                    </div>

                    {/* Company */}
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <CompanyLogo
                        companyName={company.name}
                        domain={company.domain}
                        logoUrl={company.logo_url}
                        className="h-9 w-9 flex-shrink-0 rounded-xl border border-slate-100 bg-white object-contain p-1 shadow-[0_3px_8px_rgba(15,23,42,0.04)]"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900 transition-colors group-hover:text-indigo-700">
                          {company.name}
                        </p>
                        <p className="truncate text-[11px] text-gray-400">
                          {[company.industry, company.size].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                    </div>

                    {/* Petitions */}
                    <div className="hidden w-36 flex-shrink-0 sm:block">
                      <p className="text-sm font-bold tabular-nums text-gray-900">
                        {company.h1b_sponsor_count_1yr.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-gray-400">
                        this yr · {company.h1b_sponsor_count_3yr.toLocaleString()} (3yr)
                      </p>
                    </div>

                    {/* Score */}
                    <div className="hidden w-36 flex-shrink-0 sm:block">
                      <SponsorshipScore score={company.sponsorship_confidence} size="md" />
                    </div>

                    {/* Open roles */}
                    <div className="hidden w-16 flex-shrink-0 text-right sm:block">
                      {company.job_count > 0 ? (
                        <p className="text-sm font-semibold tabular-nums text-indigo-600">
                          {company.job_count.toLocaleString()}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-300">—</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex w-20 flex-shrink-0 items-center justify-end gap-1">
                      <Link
                        href={`/dashboard/international/company/${company.id}`}
                        title="View company"
                        className="rounded-lg p-1.5 text-gray-400 opacity-0 transition group-hover:opacity-100 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => watching ? removeCompany(company.id) : addCompany(company.id)}
                        title={watching ? "Watching" : "Watch company"}
                        className={cn(
                          "rounded-lg p-1.5 transition",
                          watching
                            ? "text-[#FF5C18]"
                            : "text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-indigo-50 hover:text-indigo-600"
                        )}
                      >
                        {watching ? (
                          <BookmarkCheck className="h-3.5 w-3.5" />
                        ) : (
                          <Bookmark className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div aria-hidden className="h-[clamp(2rem,5vh,4rem)] shrink-0" />
      </div>
    </main>
  )
}
