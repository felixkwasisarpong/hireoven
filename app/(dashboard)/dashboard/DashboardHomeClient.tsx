"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  FileText,
  Globe2,
  ScanEye,
  Sparkles,
  Star,
  Zap,
} from "lucide-react"
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

export default function DashboardHomeClient() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseJobFilters(searchParams), [searchParams])
  const searchQuery = useMemo(() => getSearchQuery(searchParams), [searchParams])
  const pills = useMemo(() => buildFilterPills(filters), [filters])

  const { user, profile } = useAuth()
  const { watchlist } = useWatchlist(user?.id)
  const { hasResume, primaryResume, upsertResume } = useResumeContext()
  const primaryResumeReady = primaryResume?.parse_status === "complete"
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
    <main className="app-page neo-shell xl:flex xl:h-[100dvh] xl:flex-col xl:overflow-hidden">
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
                ? "You now have everything built for your journey - from OPT tracking to sponsorship intel."
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
      <div className="app-shell mx-auto max-w-[1720px] px-2 py-3 lg:px-3 xl:mx-0 xl:flex-1 xl:max-w-none xl:min-h-0 xl:px-0 xl:py-0">
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)] xl:h-full xl:gap-0 xl:grid-cols-[260px_minmax(0,1fr)_332px]">
          <aside className="neo-toolbar rounded-2xl p-3 lg:sticky lg:top-3 lg:self-start lg:flex lg:w-full lg:h-[calc(100dvh-4.8rem)] lg:max-h-[calc(100dvh-4.8rem)] lg:flex-col lg:overflow-hidden xl:static xl:h-full xl:max-h-none xl:self-auto xl:rounded-none xl:border-y-0 xl:border-l-0 xl:border-r xl:p-3.5 xl:shadow-none">
            <div className="flex min-h-0 flex-1 flex-col justify-between gap-4">
              <div className="soft-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
                <DashboardSidebarNav />
              </div>
              <div className="shrink-0 border-t border-border pt-5">
                <JobFilters isInternational={profile?.is_international} />
              </div>
            </div>
          </aside>

          <section className="min-w-0 space-y-4 xl:soft-scrollbar xl:h-full xl:overflow-y-auto xl:px-4 xl:py-3">
            <div className="space-y-4">
              <div className="neo-hero !px-3 !py-3 sm:!px-4 sm:!py-4">
                <div className="relative overflow-hidden rounded-xl border border-white/55">
                  <Image
                    src="/rocket.png"
                    alt="Rocket hero design"
                    width={1536}
                    height={1024}
                    className="absolute inset-0 h-full w-full object-cover"
                    priority
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-white/85 via-white/52 to-transparent" />
                  <div className="relative z-[1] flex min-h-[188px] items-center p-4 sm:min-h-[212px] sm:p-5">
                    <div className="grid w-full max-w-[820px] gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-center">
                      <div className="min-w-0 space-y-3 lg:pr-4">
                        <p className="section-kicker">Main feed</p>
                        <h1 className="text-2xl font-semibold tracking-tight text-strong sm:text-3xl">
                          Fresh roles, ready to act on
                        </h1>
                        <p className="max-w-2xl text-sm leading-relaxed text-[#2F3C61]">
                          Scan what just landed, narrow it fast, and jump directly to the
                          company application before the crowd catches up.
                        </p>
                      </div>

                      <div className="self-center border-t border-[#C4CAE0] pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#199C4A]">
                          Live signal
                        </p>
                        <p className="mt-1 text-5xl font-semibold tabular-nums text-strong">
                          {feedMeta.lastHourCount.toLocaleString()}
                        </p>
                        <p className="text-[13px] text-[#2F3C61]">
                          jobs posted in the last hour
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <PushNotificationSetup />

              <div className="neo-toolbar">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      Search & sort
                    </p>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
                    <JobSearch totalCount={feedMeta.totalCount} />

                    <div className="flex flex-wrap gap-2">
                      {SORT_OPTIONS.map((option) => {
                        const active = (filters.sort ?? "freshest") === option.value
                        const icon =
                          option.value === "freshest" ? (
                            <Zap className="h-4 w-4" />
                          ) : option.value === "match" ? (
                            <Star className="h-4 w-4" />
                          ) : null
                        return (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() =>
                              replaceFilters({ ...filters, sort: option.value })
                            }
                            className={cn(
                              "chip-control min-h-[40px] min-w-[136px] justify-center rounded-xl border px-4 text-sm",
                              active && "chip-control-active"
                            )}
                          >
                            {icon}
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
                      • {feedMeta.lastHourCount.toLocaleString()} posted in the last hour
                    </p>
                    <p className="text-sm font-semibold text-[#5E4EF1]">
                      Sorted by{" "}
                      {SORT_OPTIONS.find(
                        (option) => option.value === (filters.sort ?? "freshest")
                      )?.label.toLowerCase()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <JobFeed
              filters={filters}
              searchQuery={searchQuery}
              onMetaChange={setFeedMeta}
              hasPrimaryResume={primaryResumeReady}
            />
          </section>

          <aside className="hidden xl:flex xl:min-h-0 xl:flex-col xl:border-l xl:border-border xl:bg-transparent">
            <div className="soft-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              {!hasResume ? (
                <div className="neo-rail-card p-0">
                  <div className="p-5">
                    <ResumeUploader compact showPrompt={false} onUploadComplete={upsertResume} />
                  </div>
                </div>
              ) : primaryResume?.parse_status === "processing" ? (
                <div className="neo-rail-card">
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
                <div className="neo-rail-card">
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
                <div className="neo-rail-card">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-strong">Resume</p>
                    <Link href="/dashboard/resume" className="text-xs font-medium text-primary transition-colors hover:text-primary-hover">
                      Manage
                    </Link>
                  </div>
                  <div className="mt-3 rounded-xl border border-border bg-white/65 p-3.5">
                    <p className="truncate text-[13px] font-semibold text-strong">
                      {primaryResume?.name ?? primaryResume?.file_name ?? "Resume"}
                    </p>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="relative flex h-[70px] w-[70px] flex-shrink-0 items-center justify-center rounded-full border-4 border-[#8D80FF] bg-white text-[40px]">
                        <div className="text-center leading-none">
                          <p className="text-4xl font-semibold text-[#5E4EF1]">
                            {primaryResume?.resume_score ?? 0}
                          </p>
                          <p className="-mt-1 text-[11px] text-[#7A84A3]">/100</p>
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[#223050]">
                          {(primaryResume?.resume_score ?? 0) >= 80
                            ? "Excellent match potential"
                            : "Good match potential"}
                        </p>
                        <Link
                          href="/dashboard/resume"
                          className="mt-1 inline-flex min-w-0 items-center rounded-md border border-[#DDDDF3] bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-brand-navy leading-tight transition-colors hover:bg-[#F4F6FD]"
                        >
                          Match scores active ↗
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="neo-rail-card">
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
                  <div className="rounded-xl border border-dashed border-border bg-surface-alt/70 px-4 py-5">
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
                  <div className="rounded-xl border border-dashed border-border bg-surface-alt/70 px-4 py-5 text-xs text-muted-foreground">
                    No strong matches landed in the last 24 hours yet.
                  </div>
                ) : (
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {topMatches.map((job) => (
                      <Link
                        key={job.id}
                        href={`/dashboard/jobs/${job.id}`}
                        className="block bg-surface-alt/40 px-3 py-3 transition-colors hover:bg-white/70"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold text-strong">
                              {job.title}
                            </p>
                            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                              {job.company?.name ?? "Unknown company"}
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

              <div className="neo-rail-card">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-strong">Watchlist</p>
                  <Link href="/dashboard/watchlist" className="text-xs font-medium text-primary transition-colors hover:text-primary-hover">
                    View all
                  </Link>
                </div>

                {watchlist.length === 0 ? (
                  <div className="rounded-xl border border-[#DCD5F8] bg-[#F2EEFF] px-4 py-5 text-center">
                    <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#E5DDFF] text-[#6F5BFB]">
                      <ScanEye className="h-5 w-5" />
                    </span>
                    <p className="mt-2 text-xs text-muted-foreground">No watched companies yet.</p>
                    <Link href="/dashboard/watchlist" className="mt-1 block text-sm font-semibold text-[#5E4EF1] hover:underline">
                      Add companies →
                    </Link>
                  </div>
                ) : (
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {watchlist.slice(0, 6).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center gap-2.5 bg-surface-alt/40 px-3 py-2.5 transition-colors hover:bg-white/70"
                      >
                        <CompanyLogo
                          companyName={item.company?.name ?? "Company"}
                          domain={item.company?.domain ?? null}
                          logoUrl={item.company?.logo_url ?? null}
                          className="h-7 w-7"
                        />
                        <p className="truncate text-[13px] font-medium text-strong">
                          {item.company?.name ?? "Unknown company"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {profile?.needs_sponsorship && (
                <div className="neo-rail-card">
                  <div className="mb-3 flex items-center justify-between">
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
                            countdownTone === "green" && "bg-[#5E4EF1]",
                            countdownTone === "amber" && "bg-[#8B7FFF]",
                            countdownTone === "red" && "bg-danger"
                          )}
                          style={{ width: `${Math.min(100, Math.max(6, (optDaysRemaining / 365) * 100))}%` }}
                        />
                      </div>
                      <p className="text-xs leading-5 text-muted-foreground">
                        {countdownTone === "green" && "You still have room to be selective."}
                        {countdownTone === "amber" && "Time is tightening - prioritize direct applications."}
                        {countdownTone === "red" && "Urgency is high. Bias toward sponsor-ready companies."}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border px-4 py-4 text-xs text-muted-foreground">
                      Add your OPT end date in onboarding.
                    </div>
                  )}
                </div>
              )}

              <div className="neo-rail-card">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-strong">Hiring today</p>
                  <span className="rounded border border-brand-tint-strong bg-brand-tint px-2 py-0.5 text-[10.5px] font-semibold text-primary">
                    live
                  </span>
                </div>

                {topHiringCompanies.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-4 text-xs text-muted-foreground">
                    No hiring spikes yet today.
                  </div>
                ) : (
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {topHiringCompanies.map((company, i) => (
                      <div
                        key={company.id}
                        className="flex items-center gap-2.5 bg-surface-alt/40 px-3 py-2.5 transition-colors hover:bg-white/70"
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
