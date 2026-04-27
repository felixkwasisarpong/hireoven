"use client"

import Link from "next/link"
import { Bookmark, Building2, Search } from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import type { WatchlistWithCompany } from "@/types"

const POPULAR_SEARCHES = [
  "Software Engineer",
  "Data Scientist",
  "Product Manager",
  "Machine Learning",
  "Frontend Engineer",
  "DevOps",
  "Cloud Architect",
  "Backend Engineer",
] as const

/**
 * Lightweight side column for feed discovery and quick watchlist access.
 */
type DashboardSpotlightColumnProps = {
  initialWatchlist: WatchlistWithCompany[]
  initialWatchlistCount: number
}

export default function DashboardSpotlightColumn({
  initialWatchlist,
  initialWatchlistCount,
}: DashboardSpotlightColumnProps) {
  const visibleWatchlist = initialWatchlist.slice(0, 4)
  const remainingWatchlistCount = Math.max(0, initialWatchlistCount - visibleWatchlist.length)

  return (
    <aside className="space-y-3">
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-[#2563EB]" aria-hidden />
          <h3 className="text-[13px] font-semibold text-slate-900">Popular searches</h3>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {POPULAR_SEARCHES.map((q) => (
            <Link
              key={q}
              href={`/dashboard?q=${encodeURIComponent(q)}`}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-medium text-slate-700 transition hover:border-[#2563EB]/40 hover:bg-sky-50 hover:text-[#2563EB]"
            >
              {q}
            </Link>
          ))}
        </div>
      </section>

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
                    className="h-8 w-8 rounded-lg"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold text-slate-800">
                      {company.name}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
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
    </aside>
  )
}
