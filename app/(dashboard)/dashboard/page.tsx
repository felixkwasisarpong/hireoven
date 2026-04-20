"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { FileText, Globe2, Sparkles } from "lucide-react"
import DashboardHeader from "@/components/dashboard/DashboardHeader"
import DashboardSidebarNav from "@/components/dashboard/DashboardSidebarNav"
import JobFeed from "@/components/jobs/JobFeed"
import { MatchScorePill } from "@/components/matching/MatchScorePill"
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
import CompanyLogo from "@/components/ui/CompanyLogo"
import { useAuth } from "@/lib/hooks/useAuth"
import { useWatchlist } from "@/lib/hooks/useWatchlist"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import type { JobWithMatchScore } from "@/types"

type TopHiringCompany = {
  id: string
  name: string
  domain: string | null
  logo_url: string | null
  sponsors_h1b: boolean
  newJobsToday: number
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

  const { user, profile } = useAuth()
  const { watchlist } = useWatchlist(user?.id)
  const { hasResume, primaryResume, upsertResume } = useResumeContext()
  const [feedMeta, setFeedMeta] = useState({ totalCount: 0, lastHourCount: 0 })
  const [topHiringCompanies, setTopHiringCompanies] = useState<TopHiringCompany[]>([])
  const [topMatches, setTopMatches] = useState<JobWithMatchScore[]>([])
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; plan: string }>({ open: false, plan: "" })

  useEffect(() => {
    const upgradePlan = searchParams.get("upgrade")
    const plan = searchParams.get("plan") ?? ""
    if (upgradePlan === "success") {
      setUpgradeModal({ open: true, plan })
      const next = new URLSearchParams(searchParams.toString())
      next.delete("upgrade")
      next.delete("plan")
      router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false })
      import("canvas-confetti").then((m) => {
        m.default({ particleCount: 140, spread: 90, origin: { y: 0.5 }, colors: ["#0369A1", "#34D399", "#FBBF24"] })
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!primaryResume || primaryResume.parse_status !== "complete") return
    if (searchParams.has("sort")) return

    const next = new URLSearchParams(searchParams.toString())
    next.set("sort", "match")
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [pathname, primaryResume, router, searchParams])

  useEffect(() => {
    async function fetchTopHiringCompanies() {
      const supabase = createClient()
      const startOfDay = new Date()
      startOfDay.setHours(0, 0, 0, 0)

      const { data } = await (supabase
        .from("jobs")
        .select("company_id, company:companies(id,name,domain,logo_url,sponsors_h1b)")
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
          domain: company.domain ?? null,
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

  useEffect(() => {
    if (!primaryResume || primaryResume.parse_status !== "complete") {
      setTopMatches([])
      return
    }

    let cancelled = false

    fetch("/api/match/feed?limit=3&within=24h", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return []
        const payload = (await response.json()) as { jobs?: JobWithMatchScore[] }
        return payload.jobs ?? []
      })
      .then((jobs) => {
        if (cancelled) return
        setTopMatches(jobs)
      })

    return () => {
      cancelled = true
    }
  }, [primaryResume])

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
      {upgradeModal.open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-strong/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-[0_24px_80px_rgba(15,23,42,0.2)]">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-tint">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold tracking-tight text-strong">
              {upgradeModal.plan === "pro_international"
                ? "Welcome to Hireoven Pro International!"
                : "Welcome to Hireoven Pro!"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {upgradeModal.plan === "pro_international"
                ? "You now have everything built for your journey — from OPT tracking to sponsorship intel."
                : "You now have AI match scores, resume tools, cover letters, autofill, and deeper job intelligence unlocked."}
            </p>
            <div className="mt-4 rounded-lg border border-brand-tint-strong bg-brand-tint p-4">
              <p className="text-sm font-semibold text-brand-navy">Unlocked now</p>
              <ul className="mt-2 space-y-1.5 text-sm text-strong">
                <li>AI resume analysis and editor</li>
                <li>Match scoring across the feed</li>
                <li>Cover letters and application autofill</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={() => setUpgradeModal({ open: false, plan: "" })}
              className="mt-5 w-full rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
            >
              Let&apos;s get started
            </button>
          </div>
        </div>
      )}
      <DashboardHeader />
      <div className="app-shell mx-auto max-w-[1680px] px-4 py-4 lg:px-6">
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_312px]">
          <aside className="surface-panel rounded-xl p-3 lg:sticky lg:top-4 lg:self-start lg:flex lg:w-full lg:h-[calc(100dvh-5rem)] lg:max-h-[calc(100dvh-5rem)] lg:flex-col lg:overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col justify-between gap-4">
              <div className="soft-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
                <DashboardSidebarNav />
              </div>
              <div className="shrink-0 border-t border-border pt-5">
                <JobFilters isInternational={profile?.is_international} />
              </div>
            </div>
          </aside>

          <section className="min-w-0 space-y-5">
            <div className="space-y-5">
              <div className="surface-panel rounded-lg p-5 sm:p-6">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <p className="section-kicker">Main feed</p>
                    <h1 className="text-2xl font-semibold tracking-tight text-strong sm:text-3xl">
                      Fresh roles, ready to act on
                    </h1>
                    <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      Scan what just landed, narrow it fast, and jump directly to the
                      company application before the crowd catches up.
                    </p>
                  </div>

                  <div className="flex shrink-0 items-start">
                    <div className="min-w-[220px] border-l-0 border-t border-border pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-brand-navy">
                        Live signal
                      </p>
                      <p className="mt-1.5 text-3xl font-semibold tabular-nums text-strong">
                        {feedMeta.lastHourCount.toLocaleString()}
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        jobs posted in the last hour
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <PushNotificationSetup />
              </div>

              <div className="surface-panel rounded-lg">
                <div className="surface-toolbar px-4 py-3 sm:px-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Search & sort
                  </p>
                </div>
                <div className="space-y-4 p-4 sm:p-5">
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                    <JobSearch totalCount={feedMeta.totalCount} />

                    <div className="flex flex-wrap gap-1.5">
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
                    <div className="flex flex-wrap gap-1.5">
                      {pills.map((pill) => (
                        <button
                          key={pill.id}
                          type="button"
                          onClick={() => replaceFilters(pill.nextFilters)}
                          className="chip-control-active inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium"
                        >
                          {pill.label}
                          <span className="text-base leading-none">&times;</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="toolbar-strip !pt-3">
                    <p className="text-sm text-muted-foreground">
                      <span className="font-semibold text-strong">
                        {feedMeta.totalCount.toLocaleString()} jobs
                      </span>{" "}
                      — {feedMeta.lastHourCount.toLocaleString()} posted in the last hour
                    </p>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
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
            </div>

            <JobFeed
              filters={filters}
              searchQuery={searchQuery}
              onMetaChange={setFeedMeta}
              hasPrimaryResume={Boolean(primaryResume)}
            />
          </section>

          <aside className="hidden xl:block">
            <div className="soft-scrollbar surface-panel sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-lg">
              {/* Resume signal */}
              {!hasResume ? (
                <div className="p-5">
                  <ResumeUploader compact showPrompt={false} onUploadComplete={upsertResume} />
                </div>
              ) : primaryResume?.parse_status === "processing" ? (
                <div className="border-b border-border p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-brand-tint">
                      <FileText className="h-4.5 w-4.5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-strong">Parsing resume…</p>
                      <p className="text-xs text-muted-foreground">AI is reading your resume now</p>
                    </div>
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <div className="h-full w-3/4 animate-pulse rounded-full bg-primary" />
                  </div>
                </div>
              ) : primaryResume?.parse_status === "failed" ? (
                <div className="border-b border-border p-5">
                  <p className="text-sm font-semibold text-strong">Parse failed</p>
                  <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                    Replace with a cleaner PDF or DOCX export to unlock match scoring.
                  </p>
                  <Link
                    href="/dashboard/resume"
                    className="mt-4 inline-flex rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
                  >
                    Replace resume →
                  </Link>
                </div>
              ) : (
                <div className="border-b border-border p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-strong">Resume</p>
                    <Link href="/dashboard/resume" className="text-xs font-medium text-primary transition-colors hover:text-primary-hover">
                      Manage
                    </Link>
                  </div>
                  <div className="mt-3 rounded-md border border-border bg-surface-alt p-3.5">
                    <p className="truncate text-[13px] font-semibold text-strong">
                      {primaryResume?.name ?? primaryResume?.file_name ?? "Resume"}
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="flex-shrink-0">
                        <p className="text-2xl font-bold text-primary leading-none">
                          {primaryResume?.resume_score ?? 0}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">score</p>
                      </div>
                      <Link
                        href="/dashboard/resume"
                        className="min-w-0 flex-1 rounded-md border border-brand-tint-strong bg-surface px-2.5 py-2 text-[11.5px] font-medium text-brand-navy leading-tight transition-colors hover:bg-brand-tint"
                      >
                        {primaryResume?.parse_status === "complete"
                          ? "Match scores active ↗"
                          : "View details →"}
                      </Link>
                    </div>
                  </div>
                </div>
              )}

              <div className="border-b border-border p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-strong">Top matches today</p>
                  <Link
                    href="/dashboard/matches"
                    className="text-xs font-medium text-primary transition-colors hover:text-primary-hover"
                  >
                    View all
                  </Link>
                </div>

                {!primaryResume || primaryResume.parse_status !== "complete" ? (
                  <div className="rounded-md border border-dashed border-border bg-surface-alt px-4 py-5">
                    <p className="text-xs text-muted-foreground">
                      Upload your resume to see your strongest matches.
                    </p>
                    <Link
                      href="/dashboard/resume"
                      className="mt-2 inline-flex text-xs font-semibold text-primary hover:underline"
                    >
                      Upload resume →
                    </Link>
                  </div>
                ) : topMatches.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-surface-alt px-4 py-5 text-xs text-muted-foreground">
                    No strong matches landed in the last 24 hours yet.
                  </div>
                ) : (
                  <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                    {topMatches.map((job) => (
                      <Link
                        key={job.id}
                        href={job.apply_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block bg-surface-alt/40 px-3 py-3 transition-colors hover:bg-surface"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-strong">
                              {job.title}
                            </p>
                            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                              {job.company.name}
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              Posted{" "}
                              {Math.max(
                                1,
                                Math.floor(
                                  (Date.now() - new Date(job.first_detected_at).getTime()) /
                                    3_600_000
                                )
                              )}{" "}
                              h ago
                            </p>
                          </div>
                          <MatchScorePill
                            score={job.match_score?.overall_score ?? null}
                            method={job.match_score?.score_method ?? null}
                            isLoading={false}
                            size="sm"
                          />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Watchlist */}
              <div className="border-b border-border p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-semibold text-strong">Watchlist</p>
                  <Link href="/dashboard/watchlist" className="text-xs font-medium text-primary transition-colors hover:text-primary-hover">
                    View all
                  </Link>
                </div>

                {watchlist.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-surface-alt px-4 py-5 text-center">
                    <p className="text-xs text-muted-foreground">No watched companies yet.</p>
                    <Link href="/dashboard/watchlist" className="mt-1 block text-xs font-medium text-primary hover:underline">
                      Add companies →
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                    {watchlist.slice(0, 6).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2.5 bg-surface-alt/40 px-3 py-2.5 transition-colors hover:bg-surface"
                      >
                        <CompanyLogo
                          companyName={item.company.name}
                          domain={item.company.domain}
                          logoUrl={item.company.logo_url}
                          className="h-7 w-7"
                        />
                        <p className="truncate text-[13px] font-medium text-strong">
                          {item.company.name}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* OPT countdown */}
              {profile?.needs_sponsorship && (
                <div className="border-b border-border p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[13px] font-semibold text-strong">OPT countdown</p>
                    <Globe2 className="h-4 w-4 text-primary" />
                  </div>

                  {optDaysRemaining !== null ? (
                    <div className="space-y-2.5">
                      <p className="text-2xl font-bold text-strong leading-none">
                        {formatDays(optDaysRemaining)}
                      </p>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            countdownTone === "green" && "bg-primary",
                            countdownTone === "amber" && "bg-warning",
                            countdownTone === "red" && "bg-danger"
                          )}
                          style={{ width: `${Math.min(100, Math.max(6, (optDaysRemaining / 365) * 100))}%` }}
                        />
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {countdownTone === "green" && "You still have room to be selective."}
                        {countdownTone === "amber" && "Time is tightening — prioritize direct applications."}
                        {countdownTone === "red" && "Urgency is high. Bias toward sponsor-ready companies."}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed border-border px-4 py-4 text-xs text-muted-foreground">
                      Add your OPT end date in onboarding.
                    </div>
                  )}
                </div>
              )}

              {/* Top hiring */}
              <div className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-strong">Hiring today</p>
                  <span className="rounded border border-brand-tint-strong bg-brand-tint px-2 py-0.5 text-[10.5px] font-semibold text-primary">
                    live
                  </span>
                </div>

                {topHiringCompanies.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-4 py-4 text-xs text-muted-foreground">
                    No hiring spikes yet today.
                  </div>
                ) : (
                  <div className="divide-y divide-border rounded-md border border-border overflow-hidden">
                    {topHiringCompanies.map((company, i) => (
                      <div
                        key={company.id}
                        className="flex items-center gap-2.5 bg-surface-alt/40 px-3 py-2.5 transition-colors hover:bg-surface"
                      >
                        <span className="w-4 flex-shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground/50">
                          {i + 1}
                        </span>
                        <CompanyLogo
                          companyName={company.name}
                          domain={company.domain}
                          logoUrl={company.logo_url}
                          className="h-7 w-7"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold text-strong">
                            {company.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {company.newJobsToday} new today
                          </p>
                        </div>
                        {company.sponsors_h1b && (
                          <span className="flex-shrink-0 rounded border border-brand-tint-strong bg-brand-tint px-1.5 py-0.5 text-[10px] font-semibold text-primary">
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
