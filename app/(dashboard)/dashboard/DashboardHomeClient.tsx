"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Sparkles } from "lucide-react"
import DashboardHeader from "@/components/dashboard/DashboardHeader"
import DashboardFeedToolbar, {
  type FeedToolbarDropdown,
} from "@/components/dashboard/DashboardFeedToolbar"
import DashboardSidebarNav from "@/components/dashboard/DashboardSidebarNav"
import DashboardSpotlightColumn from "@/components/dashboard/DashboardSpotlightColumn"
import JobFeed from "@/components/jobs/JobFeed"
import PushNotificationSetup from "@/components/notifications/PushNotificationSetup"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { parseJobFilters } from "@/components/jobs/JobFilters"
import { getSearchQuery } from "@/components/jobs/JobSearch"
import HireovenLogo from "@/components/ui/HireovenLogo"
import type { WatchlistWithCompany } from "@/types"

type DashboardHomeClientProps = {
  /**
   * Server-resolved snapshot of the user's primary-resume readiness, used to avoid a
   * double-fetch on refresh: the feed can request `withScores=1` on its very first
   * request instead of waiting for the resume context to hydrate over two round-trips.
   */
  initialPrimaryResumeReady?: boolean
  initialWatchlist?: WatchlistWithCompany[]
  initialWatchlistCount?: number
}

export default function DashboardHomeClient({
  initialPrimaryResumeReady = false,
  initialWatchlist = [],
  initialWatchlistCount = 0,
}: DashboardHomeClientProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const { primaryResume, isLoading: resumeLoading } = useResumeContext()
  /**
   * While the client-side resume context is still hydrating, trust the server-rendered
   * snapshot so we don't render a single intermediate frame with the wrong assumption.
   */
  const primaryResumeReady = resumeLoading
    ? initialPrimaryResumeReady
    : primaryResume?.parse_status === "complete"

  /**
   * Default to `sort=match` once a resume is ready without rewriting the URL
   * (the old rewrite caused a visible double-fetch on first load).
   */
  const filters = useMemo(() => {
    const parsed = parseJobFilters(searchParams)
    if (!parsed.sort && primaryResumeReady) return { ...parsed, sort: "match" as const }
    return parsed
  }, [searchParams, primaryResumeReady])
  const searchQuery = useMemo(() => getSearchQuery(searchParams), [searchParams])

  const [feedMeta, setFeedMeta] = useState({ totalCount: 0, lastHourCount: 0 })
  const [upgradeModal, setUpgradeModal] = useState<{ open: boolean; plan: string }>({ open: false, plan: "" })
  const [filterDropdown, setFilterDropdown] = useState<FeedToolbarDropdown>(null)
  const filtersBarRef = useRef<HTMLDivElement>(null)

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
    function onPointerDown(e: PointerEvent) {
      if (!filterDropdown) return
      // Ignore clicks inside portalled drawers (data-portal attribute) or the filters bar itself
      if (e.target instanceof Element && e.target.closest("[data-portal-drawer]")) return
      if (e.target instanceof Node && filtersBarRef.current && !filtersBarRef.current.contains(e.target)) {
        setFilterDropdown(null)
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () => document.removeEventListener("pointerdown", onPointerDown, true)
  }, [filterDropdown])

  return (
    <main className="dashboard-feed-skin min-h-[100dvh] bg-white xl:flex xl:h-[100dvh] xl:overflow-hidden">
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
            <div className="mt-4 rounded-lg border border-[hsl(var(--accent-soft-border))] bg-[hsl(var(--accent-soft))] p-4">
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

      <aside className="flex w-full flex-col gap-4 border-b border-slate-200 bg-white p-4 xl:sticky xl:top-0 xl:h-[100dvh] xl:w-[260px] xl:flex-shrink-0 xl:border-b-0 xl:border-r xl:p-5">
        <div className="pl-0.5">
          <Link
            href="/dashboard"
            className="block rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
          >
            <HireovenLogo className="h-8 w-auto max-w-[160px]" priority />
            <span className="sr-only">Hireoven home</span>
          </Link>
        </div>

        <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
          <DashboardSidebarNav variant="light" navSkin="feed" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col xl:h-full xl:overflow-hidden">
        <DashboardHeader />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-5 px-4 py-4 sm:px-5 xl:flex-row xl:gap-5">
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto xl:soft-scrollbar">
              <section className="min-w-0 space-y-3">
                <PushNotificationSetup />

                <DashboardFeedToolbar
                  filters={filters}
                  searchQuery={searchQuery}
                  feedMeta={feedMeta}
                  filterDropdown={filterDropdown}
                  setFilterDropdown={setFilterDropdown}
                  filtersBarRef={filtersBarRef}
                />

                <JobFeed
                  filters={filters}
                  searchQuery={searchQuery}
                  onMetaChange={setFeedMeta}
                  hasPrimaryResume={primaryResumeReady}
                />
              </section>
            </div>

            <aside className="hidden min-h-0 min-w-0 xl:block xl:w-[300px] xl:flex-shrink-0 xl:overflow-y-auto">
              <DashboardSpotlightColumn
                initialWatchlist={initialWatchlist}
                initialWatchlistCount={initialWatchlistCount}
              />
            </aside>
          </div>
        </div>
      </div>
    </main>
  )
}
