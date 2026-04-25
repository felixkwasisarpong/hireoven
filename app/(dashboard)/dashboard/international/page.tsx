"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  Building2,
  Clock3,
  Database,
  Plane,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react"
import CompanyH1BCard from "@/components/international/CompanyH1BCard"
import OPTCountdown from "@/components/international/OPTCountdown"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import type { Company } from "@/types"

export default function InternationalPage() {
  const { user, profile } = useAuth()
  const { watchlist, addCompany, removeCompany, isWatching } = useWatchlist(user?.id)
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
      if (!res.ok) {
        setCompanies([])
        return
      }
      const body = (await res.json()) as { companies?: Company[] }
      const data = body.companies ?? []
      setCompanies(data as Company[])
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
    <main className="app-page">
      <div className="app-shell max-w-[88rem] space-y-6 pt-3 sm:pt-4">
        <section className="surface-card overflow-hidden rounded-xl p-0 shadow-[0_18px_55px_rgba(15,23,42,0.07)]">
          <div className="relative overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_34%),linear-gradient(135deg,#ffffff_0%,#f8fbff_54%,#fff7ed_100%)] px-5 py-6 sm:px-7 sm:py-7">
            <div className="pointer-events-none absolute right-[-80px] top-[-100px] h-64 w-64 rounded-full bg-orange-200/35 blur-3xl" />
            <div className="pointer-events-none absolute bottom-[-120px] left-[28%] h-56 w-56 rounded-full bg-indigo-200/40 blur-3xl" />
            <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_390px] lg:items-end">
              <div>
                <Link
                  href="/dashboard"
                  className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[11.5px] font-semibold text-slate-600 shadow-sm transition hover:bg-white"
                >
                  ← Back to feed
                </Link>
                <div className="flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white shadow-lg shadow-slate-900/15">
                    <Plane className="h-6 w-6" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-indigo-600">
                      International Hub
                    </p>
                    <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
                      Your sponsorship command center
                    </h1>
                  </div>
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
                  Track OPT urgency, review offer risk, discover sponsor-friendly companies, and scan fresh
                  roles without bouncing between separate pages.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Sponsor data", value: `${companies.length}`, icon: Building2, tone: "bg-indigo-50 text-indigo-700" },
                  { label: "Company search", value: "Live", icon: Search, tone: "bg-orange-50 text-orange-700" },
                  { label: "Offer checks", value: "Ready", icon: ShieldAlert, tone: "bg-amber-50 text-amber-700" },
                  { label: "LCA records", value: "Live", icon: Database, tone: "bg-emerald-50 text-emerald-700" },
                ].map((item) => {
                  const Icon = item.icon
                  return (
                    <div key={item.label} className="rounded-lg border border-white/70 bg-white/75 p-3 shadow-sm backdrop-blur">
                      <div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-lg ${item.tone}`}>
                        <Icon className="h-4 w-4" aria-hidden />
                      </div>
                      <p className="text-lg font-bold text-slate-950">{item.value}</p>
                      <p className="text-[11px] font-medium text-slate-500">{item.label}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="grid border-t border-slate-100 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="px-5 py-5 sm:px-7">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    Priority toolkit
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">
                    What do you need right now?
                  </h2>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  {
                    href: "/dashboard/international/opt-dashboard",
                    title: "OPT Survival Dashboard",
                    copy: "Timeline, unemployment days, weekly target.",
                    icon: Clock3,
                    tone: "bg-indigo-50 text-indigo-700 ring-indigo-100",
                  },
                  {
                    href: "/dashboard/international/offer-risk",
                    title: "Offer Risk Analyzer",
                    copy: "Check salary, timing, sponsorship language.",
                    icon: ShieldAlert,
                    tone: "bg-amber-50 text-amber-700 ring-amber-100",
                  },
                  {
                    href: "/dashboard/international/h1b-explorer",
                    title: "LCA Explorer",
                    copy: "Search DOL filings and employer history.",
                    icon: Database,
                    tone: "bg-emerald-50 text-emerald-700 ring-emerald-100",
                  },
                ].map((item) => {
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group rounded-lg border border-slate-100 bg-white p-4 transition hover:-translate-y-0.5 hover:border-indigo-100 hover:shadow-[0_18px_45px_rgba(15,23,42,0.07)]"
                    >
                      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ring-1 ${item.tone}`}>
                        <Icon className="h-5 w-5" aria-hidden />
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-slate-950">{item.title}</h3>
                        <ArrowUpRight className="h-4 w-4 text-slate-300 transition group-hover:text-indigo-500" />
                      </div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">{item.copy}</p>
                    </Link>
                  )
                })}
              </div>
            </div>

            <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-5 sm:px-7 lg:border-l lg:border-t-0">
              {isOptUser ? (
                <>
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    Your countdown
                  </p>
                  <OPTCountdown
                    optEndDate={profile?.opt_end_date ?? null}
                    visaStatus={profile?.visa_status ?? null}
                  />
                </>
              ) : (
                <div className="flex h-full min-h-[180px] flex-col justify-center rounded-xl bg-white p-5">
                  <Sparkles className="mb-3 h-5 w-5 text-indigo-500" />
                  <h2 className="text-base font-semibold text-slate-950">Built for visa-aware search</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Use the company and LCA intelligence below even if your current status is not OPT/STEM.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Company Explorer ── */}
        <section id="companies" className="surface-card overflow-hidden rounded-xl p-0">
          <div className="px-5 py-5 sm:px-7 sm:py-6">
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                    <Building2 className="h-4 w-4" aria-hidden />
                  </span>
                  <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                    Company Explorer
                  </p>
                </div>
                <h2 className="text-xl font-semibold text-slate-950">
                  H-1B sponsoring companies
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Ranked by petition volume - {companies.length} companies tracked.
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 sm:w-72">
                <Search className="h-4 w-4 flex-shrink-0 text-indigo-500" />
                <input
                  value={companyQuery}
                  onChange={(e) => setCompanyQuery(e.target.value)}
                  placeholder="Search companies…"
                  className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
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

      </div>
    </main>
  )
}
