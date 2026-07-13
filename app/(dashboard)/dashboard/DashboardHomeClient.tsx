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
import ResumeNudgeBanner from "@/components/dashboard/ResumeNudgeBanner"
import PushNotificationSetup from "@/components/notifications/PushNotificationSetup"
import dynamic from "next/dynamic"
const ApexMiniPanel  = dynamic(() => import("@/components/apex/ApexMiniPanel").then(m => ({ default: m.ApexMiniPanel })), { ssr: false })
const ApexFocusBanner = dynamic(() => import("@/components/apex/ApexFocusBanner").then(m => ({ default: m.ApexFocusBanner })), { ssr: false })
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
  /** Jobs first detected (or created) today, keyed by watched company id (server snapshot). */
  initialJobsTodayByCompanyId?: Record<string, number>
}

export default function DashboardHomeClient({
  initialPrimaryResumeReady = false,
  initialWatchlist = [],
  initialWatchlistCount = 0,
  initialJobsTodayByCompanyId = {},
}: DashboardHomeClientProps) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const { primaryResume, hasResume, isLoading: resumeLoading } = useResumeContext()
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
  // Read localStorage synchronously so the very first render already knows
  // whether Focus Mode is on. A deferred useEffect would cause the initial
  // feed fetch to run with sort=freshest, then lose the result when Focus Mode
  // activates mid-flight (the new refresh can't start while the old fetch holds
  // loadingRef, and the old fetch abandons due to a requestKey mismatch).
  const [localFocusMode, setLocalFocusMode] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("hireoven:apex-focus-mode:v1") === "1"
    } catch {
      return false
    }
  })
  const focusMode = searchParams.get("focus") === "1" || localFocusMode

  // Keep in sync when the URL changes (e.g. Apex navigates to ?focus=1).
  useEffect(() => {
    if (typeof window === "undefined") return
    if (searchParams.get("focus") === "1") {
      try { localStorage.setItem("hireoven:apex-focus-mode:v1", "1") } catch {}
      setLocalFocusMode(true)
      return
    }
    try {
      setLocalFocusMode(localStorage.getItem("hireoven:apex-focus-mode:v1") === "1")
    } catch {
      setLocalFocusMode(false)
    }
  }, [searchParams])

  useEffect(() => {
    function onFocusChanged(e: Event) {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail
      setLocalFocusMode(Boolean(detail?.enabled))
    }
    function onStorage(e: StorageEvent) {
      if (e.key === "hireoven:apex-focus-mode:v1") {
        setLocalFocusMode(e.newValue === "1")
      }
    }
    window.addEventListener("apex:focus-mode-changed", onFocusChanged)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener("apex:focus-mode-changed", onFocusChanged)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const filters = useMemo(() => {
    const parsed = parseJobFilters(searchParams)
    // Focus mode always sorts by match; fall back to match when resume is ready and no sort param is set
    if (focusMode) return { ...parsed, sort: "match" as const }
    if (!parsed.sort && primaryResumeReady) return { ...parsed, sort: "match" as const }
    return parsed
  }, [searchParams, primaryResumeReady, focusMode])
  const searchQuery = useMemo(() => getSearchQuery(searchParams), [searchParams])

  const [feedMeta, setFeedMeta] = useState({ totalCount: 0, hiddenTopMatches: 0 })

  // Notify Apex components (e.g. confirmation banner) whenever the feed count
  // updates — no new AI call required, purely client-side piggyback
  useEffect(() => {
    if (feedMeta.totalCount > 0 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("apex:feed-updated", {
          detail: { totalCount: feedMeta.totalCount },
        })
      )
    }
  }, [feedMeta.totalCount])
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
      // Ignore clicks inside portalled drawers or the portalled filter dropdown
      // panels (both render outside filtersBarRef via a body-level portal).
      if (
        e.target instanceof Element &&
        e.target.closest("[data-portal-drawer],[data-filter-dropdown-portal]")
      )
        return
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
              {upgradeModal.plan === "pro_max"
                ? "Welcome to Hireoven Pro Max!"
                : "Welcome to Hireoven Pro!"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {upgradeModal.plan === "pro_max"
                ? "You now have live interviews, Apex strategy insights, and unlimited AI tools unlocked."
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

      <aside className="hidden w-full flex-col gap-4 border-b border-slate-200 bg-white p-4 xl:sticky xl:top-0 xl:flex xl:h-[100dvh] xl:w-[260px] xl:flex-shrink-0 xl:border-b-0 xl:border-r xl:p-5">
        <div className="pl-0.5">
          <Link
            href="/dashboard"
            className="block rounded-lg outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
          >
            <HireovenLogo variant="full" className="h-14 w-auto max-w-[260px]" priority />
            <span className="sr-only">Hireoven home</span>
          </Link>
        </div>

        <div className="soft-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto [-webkit-overflow-scrolling:touch]">
          <DashboardSidebarNav variant="light" navSkin="feed" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col xl:h-full xl:overflow-hidden">
        <DashboardHeader />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col gap-5 px-4 py-4 sm:px-5 xl:flex-row xl:gap-5">
            <div className="relative z-20 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto xl:soft-scrollbar">
              <section className="min-w-0 space-y-3" aria-labelledby="feed-heading">
                <h1 id="feed-heading" className="sr-only">Job feed</h1>
                <PushNotificationSetup />

                <DashboardFeedToolbar
                  filters={filters}
                  searchQuery={searchQuery}
                  feedMeta={feedMeta}
                  filterDropdown={filterDropdown}
                  setFilterDropdown={setFilterDropdown}
                  filtersBarRef={filtersBarRef}
                />

                {focusMode && <ApexFocusBanner />}

                {/* New users see empty match rings with no explanation — tell
                    them the fix. Gone the moment any resume exists. */}
                {!resumeLoading && !hasResume && <ResumeNudgeBanner />}

                <JobFeed
                  filters={filters}
                  searchQuery={searchQuery}
                  onMetaChange={setFeedMeta}
                  hasPrimaryResume={primaryResumeReady}
                />
              </section>
            </div>

            <aside className="relative z-10 hidden min-h-0 min-w-0 xl:block xl:w-[300px] xl:flex-shrink-0 xl:overflow-y-auto">
              <DashboardSpotlightColumn
                initialWatchlist={initialWatchlist}
                initialWatchlistCount={initialWatchlistCount}
                initialJobsTodayByCompanyId={initialJobsTodayByCompanyId}
              />
            </aside>
          </div>
        </div>
      </div>
      <ApexMiniPanel
        pagePath="/dashboard"
        suggestionChips={[
          "Show jobs worth my time",
          "Filter high sponsorship jobs",
        ]}
      />
    </main>
  )
}
