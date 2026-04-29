"use client"

import Link from "next/link"
import { Bookmark, Building2, ChevronRight, GraduationCap, Sparkles } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import type { WatchlistWithCompany } from "@/types"

/**
 * Lightweight side column for quick watchlist access and contextual promos (UI placeholders).
 */
type DashboardSpotlightColumnProps = {
  initialWatchlist: WatchlistWithCompany[]
  initialWatchlistCount: number
  initialJobsTodayByCompanyId?: Record<string, number>
}

export default function DashboardSpotlightColumn({
  initialWatchlist,
  initialWatchlistCount,
  initialJobsTodayByCompanyId = {},
}: DashboardSpotlightColumnProps) {
  const visibleWatchlist = initialWatchlist.slice(0, 4)
  const remainingWatchlistCount = Math.max(0, initialWatchlistCount - visibleWatchlist.length)

  return (
    <aside className="space-y-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bookmark className="h-4 w-4 text-[#2563EB]" aria-hidden />
            <h3 className="text-[13px] font-semibold text-slate-900">Watchlist</h3>
          </div>
          <Link
            href="/dashboard/watchlist"
            className="text-[11px] font-semibold text-[#2563EB] transition hover:text-[#1D4ED8] hover:underline"
          >
            Manage
          </Link>
        </div>

        {visibleWatchlist.length > 0 ? (
          <div className="mt-3 space-y-1">
            {visibleWatchlist.map((item) => {
              const company = item.company
              const jobsToday = initialJobsTodayByCompanyId[company.id] ?? 0
              return (
                <Link
                  key={item.id}
                  href={`/dashboard/companies/${company.id}`}
                  className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 transition hover:bg-slate-50"
                >
                  <CompanyLogo
                    companyName={company.name}
                    domain={company.domain}
                    logoUrl={company.logo_url}
                    className="h-8 w-8 shrink-0 rounded-lg"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="block truncate text-[12.5px] font-semibold text-slate-800">
                        {company.name}
                      </span>
                      {jobsToday > 0 && (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-800">
                          +{jobsToday} today
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                      {company.industry || "Tracked company"}
                    </span>
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center">
            <Building2 className="mx-auto h-5 w-5 text-slate-400" aria-hidden />
            <p className="mt-2 text-[12px] font-semibold text-slate-700">No companies yet</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
              Add companies to track fresh openings from the employers you care about.
            </p>
            <Link
              href="/dashboard/watchlist"
              className="mt-3 inline-flex rounded-md bg-[#2563EB] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#1D4ED8]"
            >
              Build watchlist
            </Link>
          </div>
        )}

        {remainingWatchlistCount > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <Link
              href="/dashboard/watchlist"
              className="block rounded-md px-2 py-1.5 text-center text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-[#2563EB]"
            >
              View {remainingWatchlistCount} more
            </Link>
          </div>
        )}
      </section>

      <section
        aria-label="Promotion"
        className="relative isolate overflow-hidden rounded-2xl border-2 border-amber-400/55 bg-gradient-to-br from-[#FFF7ED] via-amber-50 to-orange-50 p-px shadow-[0_16px_40px_-12px_rgba(234,88,12,0.35)] ring-1 ring-amber-200/70"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -left-12 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-orange-400/35 to-amber-300/25 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-8 -right-10 h-32 w-32 rounded-full bg-gradient-to-br from-violet-500/20 to-fuchsia-400/15 blur-2xl"
        />
        <div className="relative rounded-[14px] bg-gradient-to-b from-white/85 to-orange-50/40 p-4">
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white shadow-sm">
              Premium
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-900 ring-1 ring-emerald-200/90">
              New
            </span>
          </div>

          <div className="mt-3 flex gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-orange-500/35 ring-2 ring-white/80">
              <GraduationCap className="h-6 w-6" strokeWidth={2.25} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="bg-gradient-to-r from-orange-950 via-amber-900 to-orange-950 bg-clip-text text-2xl font-black tabular-nums leading-none tracking-tight text-transparent sm:text-[1.65rem]">
                40% bonus
              </p>
              <h3 className="mt-1 text-[13px] font-bold leading-snug text-slate-900">University student offer</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-slate-700">
                Extra credit on Premium for uni students — your first year stays affordable while you keep every Pro
                feature.
              </p>
            </div>
          </div>

          <Link
            href="/dashboard/billing"
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 px-3 py-2.5 text-sm font-bold text-white shadow-[0_10px_24px_-8px_rgba(234,88,12,0.55)] ring-1 ring-orange-400/80 transition hover:brightness-105 hover:shadow-[0_12px_28px_-8px_rgba(234,88,12,0.65)] active:brightness-95"
          >
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            Claim student pricing
            <ChevronRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
          </Link>
        </div>
      </section>
    </aside>
  )
}
