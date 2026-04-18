"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  BellRing,
  Bookmark,
  Building2,
  FileText,
  Globe2,
  LogOut,
  Scroll,
  UserCircle2,
  Waves,
  Zap,
} from "lucide-react"
import GlobalSearchBar from "@/components/search/GlobalSearchBar"
import JobFeed from "@/components/jobs/JobFeed"
import NotificationBell from "@/components/notifications/NotificationBell"
import PushNotificationSetup from "@/components/notifications/PushNotificationSetup"
import ResumeUploader from "@/components/resume/ResumeUploader"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import JobFilters, {
  SORT_OPTIONS,
  buildFilterPills,
  filtersToSearchParams,
  parseJobFilters,
} from "@/components/jobs/JobFilters"
import JobSearch, {
  getSearchQuery,
  searchQueryToParams,
} from "@/components/jobs/JobSearch"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type TopHiringCompany = {
  id: string
  name: string
  logo_url: string | null
  sponsors_h1b: boolean
  newJobsToday: number
}

const NAV_ITEMS = [
  { label: "Feed",          href: "/dashboard",               icon: Waves       },
  { label: "Companies",     href: "/dashboard/companies",     icon: Building2   },
  { label: "Resume",        href: "/dashboard/resume",        icon: FileText    },
  { label: "Cover letters", href: "/dashboard/cover-letters", icon: Scroll      },
  { label: "Autofill",      href: "/dashboard/autofill",      icon: Zap         },
  { label: "Watchlist",     href: "/dashboard/watchlist",     icon: Bookmark    },
  { label: "Alerts",        href: "/dashboard/alerts",        icon: BellRing    },
  { label: "Profile",       href: "/dashboard/onboarding",    icon: UserCircle2 },
]

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "Hireoven User"
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function getCountdownTone(days: number) {
  if (days > 90) return "green"
  if (days >= 30) return "amber"
  return "red"
}

function formatDays(days: number) {
  if (days <= 0) return "0 days"
  return `${days.toLocaleString()} day${days === 1 ? "" : "s"}`
}

export default function DashboardPage() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseJobFilters(searchParams), [searchParams])
  const searchQuery = useMemo(() => getSearchQuery(searchParams), [searchParams])
  const pills = useMemo(() => buildFilterPills(filters), [filters])

  const { user, profile, isLoading: authLoading, signOut } = useAuth()
  const { watchlist } = useWatchlist(user?.id)
  const { hasResume, primaryResume, upsertResume } = useResumeContext()
  const [feedMeta, setFeedMeta] = useState({ totalCount: 0, lastHourCount: 0 })
  const [topHiringCompanies, setTopHiringCompanies] = useState<TopHiringCompany[]>([])

  useEffect(() => {
    async function fetchTopHiringCompanies() {
      const supabase = createClient()
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)

      const { data } = await (supabase
        .from("jobs")
        .select("company_id, company:companies(id,name,logo_url,sponsors_h1b)")
        .eq("is_active", true)
        .gte("first_detected_at", startOfDay.toISOString())
        .order("first_detected_at", { ascending: false })
        .limit(250) as any)

      const grouped = new Map<string, TopHiringCompany>()

      for (const row of (data ?? []) as any[]) {
        const company = row.company
        if (!company?.id) continue

        const current = grouped.get(company.id)
        if (current) {
          current.newJobsToday += 1
          continue
        }

        grouped.set(company.id, {
          id: company.id,
          name: company.name,
          logo_url: company.logo_url,
          sponsors_h1b: company.sponsors_h1b,
          newJobsToday: 1,
        })
      }

      setTopHiringCompanies(
        Array.from(grouped.values())
          .sort((left, right) => right.newJobsToday - left.newJobsToday)
          .slice(0, 5)
      )
    }

    void fetchTopHiringCompanies()
  }, [])

  function replaceFilters(nextFilters: typeof filters) {
    const next = filtersToSearchParams(searchParams, nextFilters)
    const withSearch = searchQueryToParams(next, searchQuery)
    const value = withSearch.toString()
    router.replace(value ? `${pathname}?${value}` : pathname, { scroll: false })
  }

  const optDaysRemaining = useMemo(() => {
    if (!profile?.needs_sponsorship || !profile.opt_end_date) return null
    const diff =
      new Date(profile.opt_end_date).getTime() - new Date().setHours(0, 0, 0, 0)
    return Math.ceil(diff / 86_400_000)
  }, [profile?.needs_sponsorship, profile?.opt_end_date])

  const countdownTone = optDaysRemaining === null ? null : getCountdownTone(optDaysRemaining)

  return (
    <main className="app-page">
      {/* Sticky global search bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/92 backdrop-blur-xl">
        <div className="mx-auto grid max-w-[1680px] items-center gap-4 px-4 py-3 lg:grid-cols-[252px_minmax(0,1fr)] lg:px-6 xl:grid-cols-[252px_minmax(0,1fr)_320px]">
          <div className="hidden lg:flex items-center text-xs font-medium uppercase tracking-[0.2em] text-slate-400">
            Job seeker dashboard
          </div>
          <div className="min-w-0">
            <GlobalSearchBar />
          </div>
          <div className="hidden xl:flex justify-end">
            <NotificationBell userId={user?.id} />
          </div>
        </div>
      </header>
      <div className="app-shell mx-auto max-w-[1680px] px-4 py-4 lg:px-6">
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_312px]">
          <aside className="soft-scrollbar rounded-[20px] border border-slate-200/70 bg-white p-3.5 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)] lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="flex h-full flex-col">
              <div className="px-2 pb-5 pt-2">
                <HireovenLogo className="h-10 w-auto max-w-[152px]" priority />
              </div>

              <nav className="space-y-0.5">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon
                  const active = pathname === item.href
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-all duration-100",
                        active
                          ? "bg-[#062246] text-white shadow-[0_4px_12px_rgba(6,34,70,0.2)]"
                          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <Icon className={cn("h-[15px] w-[15px] flex-shrink-0", active ? "text-white/90" : "text-slate-400")} />
                      {item.label}
                    </Link>
                  )
                })}

                <div className="pt-2">
                  <Link
                    href="/dashboard/international"
                    className="flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium text-slate-600 transition-all duration-100 hover:bg-[#FFF1E8] hover:text-[#9A3412]"
                  >
                    <Globe2 className="h-[15px] w-[15px] flex-shrink-0 text-[#FF5C18]" />
                    <span className="flex items-center gap-1.5">
                      International
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]" />
                    </span>
                  </Link>
                </div>
              </nav>

              <div className="mt-6 border-t border-slate-200/60 pt-5">
                <JobFilters isInternational={profile?.is_international} />
              </div>

              <div className="mt-auto pt-4">
                <div className="rounded-[12px] border border-slate-200/70 bg-slate-50/80 p-3">
                  <div className="flex items-center gap-2.5">
                    {profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profile.avatar_url}
                        alt={profile.full_name ?? "User avatar"}
                        className="h-9 w-9 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#FFF1E8] text-xs font-bold text-[#062246]">
                        {getInitials(profile?.full_name, profile?.email)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-gray-900 leading-tight">
                        {profile?.full_name || (authLoading ? "…" : "Your profile")}
                      </p>
                      <p className="truncate text-[11px] text-slate-400 mt-0.5">
                        {profile?.email || user?.email || "Signed in"}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <section className="min-w-0 space-y-5">
            <div className="space-y-5">
              <div className="flex flex-col gap-4 border-b border-slate-200/80 pb-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#FF5C18]">
                    Main feed
                  </p>
                  <h1 className="text-3xl font-semibold tracking-tight text-gray-900">
                    Fresh roles, ready to act on
                  </h1>
                  <p className="max-w-2xl text-sm leading-6 text-gray-500">
                    Scan what just landed, narrow it fast, and jump directly to the
                    company application before the crowd catches up.
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <div className="min-w-[240px] rounded-[18px] border border-[#FFD9C2] bg-[#FFF8F4] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#062246]">
                      Live signal
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-gray-900">
                      {feedMeta.lastHourCount.toLocaleString()}
                    </p>
                    <p className="text-sm text-gray-600">
                      jobs posted in the last hour
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <PushNotificationSetup />
              </div>

              <div className="rounded-[20px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.04)]">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                  <JobSearch totalCount={feedMeta.totalCount} />

                  <div className="flex flex-wrap gap-2">
                    {SORT_OPTIONS.map((option) => {
                      const active = (filters.sort ?? "freshest") === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            replaceFilters({ ...filters, sort: option.value })
                          }
                          className={cn("chip-control", active && "chip-control-active")}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {pills.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {pills.map((pill) => (
                      <button
                        key={pill.id}
                        type="button"
                        onClick={() => replaceFilters(pill.nextFilters)}
                        className="chip-control-active inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium"
                      >
                        {pill.label}
                        <span className="text-base leading-none">&times;</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">
                      {feedMeta.totalCount.toLocaleString()} jobs
                    </span>{" "}
                    — {feedMeta.lastHourCount.toLocaleString()} posted in the last hour
                  </p>
                  <p className="text-xs font-medium uppercase tracking-[0.22em] text-gray-400">
                    Sorted by{" "}
                    {
                      SORT_OPTIONS.find(
                        (option) => option.value === (filters.sort ?? "freshest")
                      )?.label
                    }
                  </p>
                </div>
              </div>
            </div>

            <JobFeed
              filters={filters}
              searchQuery={searchQuery}
              onMetaChange={setFeedMeta}
              hasPrimaryResume={Boolean(primaryResume)}
            />
          </section>

          <aside className="hidden xl:block">
            <div className="soft-scrollbar sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[20px] border border-slate-200/70 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
              {/* Resume signal */}
              {!hasResume ? (
                <div className="p-5">
                  <ResumeUploader compact showPrompt={false} onUploadComplete={upsertResume} />
                </div>
              ) : primaryResume?.parse_status === "processing" ? (
                <div className="border-b border-slate-200/60 p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[14px] bg-[#FFF1E8]">
                      <FileText className="h-4.5 w-4.5 text-[#FF5C18]" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Parsing resume…</p>
                      <p className="text-xs text-slate-400">AI is reading your resume now</p>
                    </div>
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full w-3/4 animate-pulse rounded-full bg-[#FF5C18]" />
                  </div>
                </div>
              ) : primaryResume?.parse_status === "failed" ? (
                <div className="border-b border-slate-200/60 p-5">
                  <p className="text-sm font-semibold text-gray-900">Parse failed</p>
                  <p className="mt-1.5 text-xs leading-5 text-slate-500">
                    Replace with a cleaner PDF or DOCX export to unlock match scoring.
                  </p>
                  <Link
                    href="/dashboard/resume"
                    className="mt-4 inline-flex rounded-[14px] bg-[#FF5C18] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#E14F0E]"
                  >
                    Replace resume →
                  </Link>
                </div>
              ) : (
                <div className="border-b border-slate-200/60 p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-gray-900">Resume</p>
                    <Link href="/dashboard/resume" className="text-xs font-medium text-[#FF5C18] hover:text-[#E14F0E]">
                      Manage
                    </Link>
                  </div>
                  <div className="mt-3 rounded-[14px] border border-slate-200/60 bg-slate-50/80 p-3.5">
                    <p className="truncate text-[13px] font-semibold text-gray-900">
                      {primaryResume?.name ?? primaryResume?.file_name ?? "Resume"}
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-shrink-0">
                        <p className="text-2xl font-bold text-[#FF5C18] leading-none">
                          {primaryResume?.resume_score ?? 0}
                        </p>
                        <p className="text-[10px] text-slate-400 mt-0.5">score</p>
                      </div>
                      <Link
                        href="/dashboard/resume"
                        className="min-w-0 flex-1 rounded-xl border border-[#FFD2B8] bg-white px-2.5 py-2 text-[11.5px] font-medium text-[#062246] leading-tight transition hover:bg-[#FFF1E8]"
                      >
                        {primaryResume?.parse_status === "complete"
                          ? "Match scores active ↗"
                          : "View details →"}
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              {/* Watchlist */}
              <div className="border-b border-slate-200/60 p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-semibold text-gray-900">Watchlist</p>
                  <Link href="/dashboard/watchlist" className="text-xs font-medium text-[#FF5C18] hover:text-[#E14F0E]">
                    View all
                  </Link>
                </div>

                {watchlist.length === 0 ? (
                  <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center">
                    <p className="text-xs text-slate-400">No watched companies yet.</p>
                    <Link href="/dashboard/watchlist" className="mt-1 block text-xs font-medium text-[#FF5C18] hover:underline">
                      Add companies →
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {watchlist.slice(0, 6).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2.5 rounded-[12px] border border-slate-200/60 bg-slate-50/60 px-3 py-2.5 transition hover:border-slate-300 hover:bg-white"
                      >
                        {item.company.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.company.logo_url} alt={item.company.name} className="h-7 w-7 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#FFF1E8] text-[11px] font-bold text-[#062246]">
                            {item.company.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <p className="truncate text-[13px] font-medium text-gray-800">
                          {item.company.name}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* OPT countdown */}
              {profile?.needs_sponsorship && (
                <div className="border-b border-slate-200/60 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[13px] font-semibold text-gray-900">OPT countdown</p>
                    <Globe2 className="h-4 w-4 text-[#FF5C18]" />
                  </div>

                  {optDaysRemaining !== null ? (
                    <div className="space-y-2.5">
                      <p className="text-2xl font-bold text-gray-900 leading-none">
                        {formatDays(optDaysRemaining)}
                      </p>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            countdownTone === "green" && "bg-[#FF5C18]",
                            countdownTone === "amber" && "bg-amber-400",
                            countdownTone === "red" && "bg-red-500"
                          )}
                          style={{ width: `${Math.min(100, Math.max(6, (optDaysRemaining / 365) * 100))}%` }}
                        />
                      </div>
                      <p className="text-xs leading-5 text-slate-500">
                        {countdownTone === "green" && "You still have room to be selective."}
                        {countdownTone === "amber" && "Time is tightening — prioritize direct applications."}
                        {countdownTone === "red" && "Urgency is high. Bias toward sponsor-ready companies."}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-[14px] border border-dashed border-slate-200 px-4 py-4 text-xs text-slate-400">
                      Add your OPT end date in onboarding.
                    </div>
                  )}
                </div>
              )}

              {/* Top hiring */}
              <div className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-gray-900">Hiring today</p>
                  <span className="rounded-full bg-[#FFF1E8] px-2 py-0.5 text-[10.5px] font-semibold text-[#FF5C18]">
                    live
                  </span>
                </div>

                {topHiringCompanies.length === 0 ? (
                  <div className="rounded-[14px] border border-dashed border-slate-200 px-4 py-4 text-xs text-slate-400">
                    No hiring spikes yet today.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {topHiringCompanies.map((company, i) => (
                      <div
                        key={company.id}
                        className="flex items-center gap-2.5 rounded-[12px] border border-slate-200/60 bg-slate-50/60 px-3 py-2.5 transition hover:border-slate-300 hover:bg-white"
                      >
                        <span className="text-[11px] font-bold text-slate-300 w-4 flex-shrink-0">
                          {i + 1}
                        </span>
                        {company.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={company.logo_url} alt={company.name} className="h-7 w-7 rounded-lg object-cover flex-shrink-0" />
                        ) : (
                          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#FFF1E8] text-[11px] font-bold text-[#062246]">
                            {company.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold text-gray-900">
                            {company.name}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {company.newJobsToday} new today
                          </p>
                        </div>
                        {company.sponsors_h1b && (
                          <span className="flex-shrink-0 rounded-full bg-[#FFF1E8] px-1.5 py-0.5 text-[10px] font-semibold text-[#FF5C18]">
                            H1B
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
