"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  Bookmark,
  Building2,
  ChevronRight,
  GraduationCap,
  Gift,
  Rocket,
  Sparkles,
  Star,
  Zap,
} from "lucide-react"
import CompanyLogo from "@/components/ui/CompanyLogo"
import type { WatchlistWithCompany } from "@/types"
import type { ActivePromo } from "@/app/api/promos/active/route"

type DashboardSpotlightColumnProps = {
  initialWatchlist: WatchlistWithCompany[]
  initialWatchlistCount: number
  initialJobsTodayByCompanyId?: Record<string, number>
}

// ── Theme config ──────────────────────────────────────────────────────────────

const THEME = {
  orange: {
    outer:   "border-amber-400/55 shadow-[0_16px_40px_-12px_rgba(234,88,12,0.35)] ring-amber-200/70",
    glow1:   "from-orange-400/35 to-amber-300/25",
    glow2:   "from-violet-500/20 to-fuchsia-400/15",
    badge:   "from-amber-500 to-orange-600",
    icon:    "from-amber-500 to-orange-600 shadow-orange-500/35",
    title:   "from-orange-950 via-amber-900 to-orange-950",
    cta:     "from-orange-600 to-amber-600 shadow-[0_10px_24px_-8px_rgba(234,88,12,0.55)] ring-orange-400/80 hover:shadow-[0_12px_28px_-8px_rgba(234,88,12,0.65)]",
    bg:      "from-[#FFF7ED] via-amber-50 to-orange-50",
  },
  blue: {
    outer:   "border-blue-400/55 shadow-[0_16px_40px_-12px_rgba(37,99,235,0.30)] ring-blue-200/70",
    glow1:   "from-blue-400/35 to-orange-300/25",
    glow2:   "from-violet-500/20 to-blue-400/15",
    badge:   "from-blue-500 to-orange-600",
    icon:    "from-blue-500 to-orange-600 shadow-blue-500/35",
    title:   "from-blue-950 via-orange-900 to-blue-950",
    cta:     "from-blue-600 to-orange-600 shadow-[0_10px_24px_-8px_rgba(37,99,235,0.45)] ring-blue-400/80 hover:shadow-[0_12px_28px_-8px_rgba(37,99,235,0.55)]",
    bg:      "from-[#EFF6FF] via-blue-50 to-orange-50",
  },
  green: {
    outer:   "border-emerald-400/55 shadow-[0_16px_40px_-12px_rgba(16,185,129,0.30)] ring-emerald-200/70",
    glow1:   "from-emerald-400/35 to-teal-300/25",
    glow2:   "from-teal-500/20 to-green-400/15",
    badge:   "from-emerald-500 to-teal-600",
    icon:    "from-emerald-500 to-teal-600 shadow-emerald-500/35",
    title:   "from-emerald-950 via-teal-900 to-emerald-950",
    cta:     "from-emerald-600 to-teal-600 shadow-[0_10px_24px_-8px_rgba(16,185,129,0.45)] ring-emerald-400/80 hover:shadow-[0_12px_28px_-8px_rgba(16,185,129,0.55)]",
    bg:      "from-[#F0FDF4] via-emerald-50 to-teal-50",
  },
  purple: {
    outer:   "border-violet-400/55 shadow-[0_16px_40px_-12px_rgba(139,92,246,0.30)] ring-violet-200/70",
    glow1:   "from-violet-400/35 to-purple-300/25",
    glow2:   "from-fuchsia-500/20 to-violet-400/15",
    badge:   "from-violet-500 to-purple-600",
    icon:    "from-violet-500 to-purple-600 shadow-violet-500/35",
    title:   "from-violet-950 via-purple-900 to-violet-950",
    cta:     "from-violet-600 to-purple-600 shadow-[0_10px_24px_-8px_rgba(139,92,246,0.45)] ring-violet-400/80 hover:shadow-[0_12px_28px_-8px_rgba(139,92,246,0.55)]",
    bg:      "from-[#F5F3FF] via-violet-50 to-purple-50",
  },
} as const

type ThemeKey = keyof typeof THEME

function PromoIcon({ icon, className }: { icon: string; className?: string }) {
  const props = { className: className ?? "h-6 w-6", strokeWidth: 2.25, "aria-hidden": true }
  switch (icon) {
    case "graduation": return <GraduationCap {...props} />
    case "gift":       return <Gift {...props} />
    case "zap":        return <Zap {...props} />
    case "star":       return <Star {...props} />
    case "rocket":     return <Rocket {...props} />
    default:           return <Sparkles {...props} />
  }
}

/**
 * Returns the href if parseable against a dummy origin, otherwise null.
 * Guards against malformed promo CTAs from the database (the unguarded value
 * would crash Next.js's <Link> prefetch with "Failed to construct 'URL'").
 */
function safeHref(href: string | null | undefined): string | null {
  if (typeof href !== "string") return null
  const trimmed = href.trim()
  if (!trimmed) return null
  try {
    new URL(trimmed, "https://hireoven.com")
    return trimmed
  } catch {
    return null
  }
}

function PromoCard({ promo }: { promo: ActivePromo }) {
  const t = THEME[(promo.theme as ThemeKey) ?? "orange"] ?? THEME.orange
  const ctaHref = safeHref(promo.cta_url)
  if (!ctaHref) return null
  const isExternal = /^https?:\/\//i.test(ctaHref)

  return (
    <section
      aria-label="Promotion"
      className={`relative isolate overflow-hidden rounded-2xl border-2 bg-gradient-to-br p-px ring-1 ${t.bg} ${t.outer}`}
    >
      <div aria-hidden className={`pointer-events-none absolute -left-12 -top-16 h-40 w-40 rounded-full bg-gradient-to-br ${t.glow1} blur-2xl`} />
      <div aria-hidden className={`pointer-events-none absolute -bottom-8 -right-10 h-32 w-32 rounded-full bg-gradient-to-br ${t.glow2} blur-2xl`} />

      <div className="relative rounded-[14px] bg-gradient-to-b from-white/85 to-orange-50/40 p-4">
        {/* Badges row */}
        <div className="flex items-start justify-between gap-2">
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r ${t.badge} px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.08em] text-white shadow-sm`}>
            {promo.badge_label}
          </span>
          {promo.is_new && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-emerald-900 ring-1 ring-emerald-200/90">
              New
            </span>
          )}
        </div>

        {/* Icon + headline */}
        <div className="mt-3 flex gap-3">
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${t.icon} text-white shadow-md ring-2 ring-white/80`}>
            <PromoIcon icon={promo.icon} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`bg-gradient-to-r ${t.title} bg-clip-text text-2xl font-black tabular-nums leading-none tracking-tight text-transparent sm:text-[1.65rem]`}>
              {promo.title}
            </p>
            <h3 className="mt-1 text-[13px] font-bold leading-snug text-slate-900">{promo.subtitle}</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-700">{promo.description}</p>
          </div>
        </div>

        {/* CTA — external links use <a> to avoid Next.js Link prefetch on potentially-rich URLs */}
        {isExternal ? (
          <a
            href={ctaHref}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r ${t.cta} px-3 py-2.5 text-sm font-bold text-white ring-1 transition hover:brightness-105 active:brightness-95`}
          >
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            {promo.cta_label}
            <ChevronRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
          </a>
        ) : (
          <Link
            href={ctaHref}
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r ${t.cta} px-3 py-2.5 text-sm font-bold text-white ring-1 transition hover:brightness-105 active:brightness-95`}
          >
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
            {promo.cta_label}
            <ChevronRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
          </Link>
        )}
      </div>
    </section>
  )
}

export default function DashboardSpotlightColumn({
  initialWatchlist,
  initialWatchlistCount,
  initialJobsTodayByCompanyId = {},
}: DashboardSpotlightColumnProps) {
  const visibleWatchlist = initialWatchlist.slice(0, 4)
  const remainingWatchlistCount = Math.max(0, initialWatchlistCount - visibleWatchlist.length)
  const [promo, setPromo] = useState<ActivePromo | null>(null)

  useEffect(() => {
    fetch("/api/promos/active")
      .then(r => r.ok ? r.json() : null)
      .then((d: { promo?: ActivePromo | null } | null) => { if (d?.promo) setPromo(d.promo) })
      .catch(() => {})
  }, [])

  return (
    <aside className="space-y-3">
      {/* Watchlist */}
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

      {/* Active promo — only rendered when one exists */}
      {promo && <PromoCard promo={promo} />}
    </aside>
  )
}
