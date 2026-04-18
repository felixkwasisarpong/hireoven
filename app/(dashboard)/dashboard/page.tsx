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
  UserCircle2,
  Waves,
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
  { label: "Feed",      href: "/dashboard",           icon: Waves      },
  { label: "Companies", href: "/dashboard/companies", icon: Building2  },
  { label: "Resume",    href: "/dashboard/resume",    icon: FileText   },
  { label: "Watchlist", href: "/dashboard/watchlist", icon: Bookmark   },
  { label: "Alerts",    href: "/dashboard/alerts",    icon: BellRing   },
  { label: "Profile",   href: "/dashboard/onboarding",icon: UserCircle2},
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(3,105,161,0.10),_transparent_35%),linear-gradient(180deg,#F7FBFF_0%,#F8FAFC_55%,#F8FAFC_100%)]">
      {/* Sticky global search bar */}
      <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1680px] items-center gap-4 px-4 py-3 lg:px-6">
          <div className="hidden w-[240px] flex-shrink-0 lg:block" />
          <div className="flex flex-1 justify-center">
            <GlobalSearchBar />
          </div>
          <div className="hidden w-[240px] flex-shrink-0 xl:block" />
        </div>
      </header>
      <div className="mx-auto max-w-[1680px] px-4 py-4 lg:px-6">
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_320px]">
          <aside className="rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="flex h-full flex-col">
              <div className="px-2 pb-6 pt-2">
                <HireovenLogo className="h-11 w-auto max-w-[168px]" priority />
                <p className="mt-2 text-xs text-gray-500">Jobs served fresh</p>
              </div>

              <nav className="space-y-1">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon
                  const active = pathname === item.href
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition",
                        active
                          ? "bg-[#F0F9FF] text-[#0C4A6E]"
                          : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  )
                })}

                <Link
                  href="/dashboard/onboarding"
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#E0F2FE] text-[#0C4A6E]">
                    <Globe2 className="h-4 w-4" />
                  </span>
                  <span className="flex items-center gap-2">
                    For International
                    <span className="h-2 w-2 rounded-full bg-[#0369A1]" />
                  </span>
                </Link>
              </nav>

              <div className="mt-8 rounded-[24px] border border-gray-200 bg-[#F8FBFF] p-4">
                <JobFilters isInternational={profile?.is_international} />
              </div>

              <div className="mt-auto rounded-[24px] border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  {profile?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatar_url}
                      alt={profile.full_name ?? "User avatar"}
                      className="h-11 w-11 rounded-2xl object-cover"
                    />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E0F2FE] text-sm font-semibold text-[#0C4A6E]">
                      {getInitials(profile?.full_name, profile?.email)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-900">
                      {profile?.full_name || (authLoading ? "Loading…" : "Your profile")}
                    </p>
                    <p className="truncate text-xs text-gray-500">
                      {profile?.email || user?.email || "Signed in"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          </aside>

          <section className="min-w-0 space-y-5">
            <div className="rounded-[32px] border border-white/70 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] backdrop-blur">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-[#0369A1]">
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
                  <NotificationBell userId={user?.id} />
                  <div className="min-w-[240px] rounded-3xl border border-[#D6EEFF] bg-[#F5FBFF] px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#0C4A6E]">
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

              <div className="mt-6">
                <PushNotificationSetup />
              </div>

              <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
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
                        className={cn(
                          "rounded-full px-4 py-2 text-sm font-medium transition",
                          active
                            ? "bg-[#0369A1] text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900"
                        )}
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
                      className="inline-flex items-center gap-2 rounded-full bg-[#F0F9FF] px-3 py-1.5 text-sm font-medium text-[#0C4A6E] transition hover:bg-[#D6EEFF]"
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

            <JobFeed
              filters={filters}
              searchQuery={searchQuery}
              onMetaChange={setFeedMeta}
              hasPrimaryResume={Boolean(primaryResume)}
            />
          </section>

          <aside className="hidden xl:block">
            <div className="sticky top-4 flex h-[calc(100vh-2rem)] flex-col gap-4 overflow-y-auto">
              {!hasResume ? (
                <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                  <ResumeUploader
                    compact
                    showPrompt={false}
                    onUploadComplete={upsertResume}
                  />
                </div>
              ) : primaryResume?.parse_status === "processing" ? (
                <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#E0F2FE] text-[#0C4A6E]">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Resume analysis</p>
                      <p className="text-xs text-gray-500">AI is reading your resume now</p>
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full w-full animate-pulse rounded-full bg-[#0369A1]" />
                  </div>
                </div>
              ) : primaryResume?.parse_status === "failed" ? (
                <div className="rounded-[28px] border border-red-200 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                  <p className="text-sm font-semibold text-gray-900">Resume analysis stalled</p>
                  <p className="mt-2 text-sm leading-6 text-gray-600">
                    Replace your uploaded file on the resume page to unlock match scoring and autofill.
                  </p>
                  <Link
                    href="/dashboard/resume"
                    className="mt-4 inline-flex rounded-2xl bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985]"
                  >
                    Open resume page
                  </Link>
                </div>
              ) : (
                <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Resume signal</p>
                      <p className="text-xs text-gray-500">
                        Your uploaded resume now powers the next layer of matching
                      </p>
                    </div>
                    <Link
                      href="/dashboard/resume"
                      className="text-xs font-medium text-[#0369A1] transition hover:text-[#0C4A6E]"
                    >
                      Manage
                    </Link>
                  </div>

                  <div className="mt-4 rounded-[24px] border border-[#D6EEFF] bg-[#F5FBFF] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0C4A6E]">
                      Primary resume
                    </p>
                    <p className="mt-1.5 truncate text-sm font-semibold text-gray-900">
                      {primaryResume?.name ?? primaryResume?.file_name ?? "Resume"}
                    </p>
                    <div className="mt-4 flex items-end gap-3">
                      <div className="shrink-0">
                        <p className="text-3xl font-semibold text-[#0369A1]">
                          {primaryResume?.resume_score ?? 0}
                        </p>
                        <p className="text-xs text-gray-500">resume score</p>
                      </div>
                      <div className="min-w-0 flex-1 rounded-2xl border border-[#BAE6FD] bg-white px-3 py-2 text-xs font-medium text-[#0C4A6E]">
                        Match scoring coming soon
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      Your watchlist
                    </p>
                    <p className="text-xs text-gray-500">
                      Companies you want to jump on first
                    </p>
                  </div>
                  <Link
                    href="/dashboard/watchlist"
                    className="text-xs font-medium text-[#0369A1] transition hover:text-[#0C4A6E]"
                  >
                    View all
                  </Link>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {watchlist.slice(0, 6).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-gray-200 bg-[#FAFCFB] p-3"
                    >
                      <div className="flex items-center gap-2">
                        {item.company.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.company.logo_url}
                            alt={item.company.name}
                            className="h-8 w-8 rounded-xl object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#E0F2FE] text-xs font-semibold text-[#0C4A6E]">
                            {item.company.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <p className="truncate text-sm font-medium text-gray-800">
                          {item.company.name}
                        </p>
                      </div>
                    </div>
                  ))}

                  {watchlist.length === 0 && (
                    <div className="col-span-2 rounded-2xl border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
                      No watched companies yet.
                    </div>
                  )}
                </div>
              </div>

              {profile?.needs_sponsorship && (
                <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        OPT countdown
                      </p>
                      <p className="text-xs text-gray-500">
                        Keep the urgency visible
                      </p>
                    </div>
                    <Globe2 className="h-5 w-5 text-[#0369A1]" />
                  </div>

                  {optDaysRemaining !== null ? (
                    <div className="mt-4 space-y-3">
                      <p className="text-3xl font-semibold text-gray-900">
                        {formatDays(optDaysRemaining)}
                      </p>
                      <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            countdownTone === "green" && "bg-[#0369A1]",
                            countdownTone === "amber" && "bg-amber-400",
                            countdownTone === "red" && "bg-red-500"
                          )}
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(8, (optDaysRemaining / 365) * 100)
                            )}%`,
                          }}
                        />
                      </div>
                      <p className="text-sm leading-6 text-gray-600">
                        {countdownTone === "green" &&
                          "You still have room to be selective. Prioritize the freshest sponsor-friendly roles."}
                        {countdownTone === "amber" &&
                          "Time is tightening. Focus on companies with clear sponsorship history and direct applications."}
                        {countdownTone === "red" &&
                          "Urgency is high. Bias heavily toward sponsor-ready companies and same-day applications."}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                      Add your OPT end date in onboarding to track the countdown here.
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-[28px] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)]">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    Top hiring companies
                  </p>
                  <p className="text-xs text-gray-500">
                    Most new roles added today
                  </p>
                </div>

                <div className="mt-4 space-y-3">
                  {topHiringCompanies.map((company) => (
                    <div
                      key={company.id}
                      className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-[#FAFCFB] px-3 py-3"
                    >
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
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">
                          {company.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {company.newJobsToday} new job
                          {company.newJobsToday === 1 ? "" : "s"} today
                        </p>
                      </div>
                      {company.sponsors_h1b && (
                        <span className="rounded-full bg-[#F0F9FF] px-2 py-1 text-[11px] font-medium text-[#0C4A6E]">
                          H1B
                        </span>
                      )}
                    </div>
                  ))}

                  {topHiringCompanies.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-gray-300 px-4 py-5 text-sm text-gray-500">
                      No hiring spikes yet today.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  )
}
