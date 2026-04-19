"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BellRing,
  Bookmark,
  Briefcase,
  Building2,
  CreditCard,
  FileText,
  Globe2,
  LogOut,
  Scroll,
  UserCircle2,
  Waves,
  X,
  Zap,
} from "lucide-react"
import GlobalSearchBar from "@/components/search/GlobalSearchBar"
import NotificationBell from "@/components/notifications/NotificationBell"
import HireovenLogo from "@/components/ui/HireovenLogo"
import { ResumeProvider } from "@/components/resume/ResumeProvider"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { cn } from "@/lib/utils"

const NUDGE_DISMISS_KEY = "upgrade_nudge_dismissed_at"
const NUDGE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const TRIAL_BANNER_DISMISS_KEY = "trial_banner_dismissed_at"

function TrialReminderBanner() {
  const { status, trialDaysRemaining, isPro } = useSubscription()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const dismissedAt = localStorage.getItem(TRIAL_BANNER_DISMISS_KEY)
    if (dismissedAt && Date.now() - Number(dismissedAt) < 24 * 60 * 60 * 1000) {
      setDismissed(true)
    }
  }, [])

  if (dismissed || !isPro) return null

  const isPaymentFailed = status === "past_due" || status === "unpaid"
  const isTrial = status === "trialing" && typeof trialDaysRemaining === "number"

  if (!isPaymentFailed && !isTrial) return null

  const urgent = isPaymentFailed || (trialDaysRemaining ?? 99) <= 3

  async function openPortal() {
    const response = await fetch("/api/stripe/portal", { method: "POST" })
    const data = await response.json().catch(() => ({}))
    if (data.url) window.location.href = data.url
  }

  function dismiss() {
    localStorage.setItem(TRIAL_BANNER_DISMISS_KEY, String(Date.now()))
    setDismissed(true)
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium",
        isPaymentFailed
          ? "border-b border-red-200 bg-red-50 text-red-800"
          : urgent
            ? "border-b border-amber-200 bg-amber-50 text-amber-900"
            : "border-b border-emerald-200 bg-emerald-50 text-emerald-800"
      )}
    >
      <span>
        {isPaymentFailed
          ? "Your trial has ended — add a payment method to keep your Pro features."
          : urgent
            ? `Your trial ends in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"}.`
            : `Pro trial active — ${trialDaysRemaining} days remaining.`}
      </span>
      {urgent && (
        <button
          type="button"
          onClick={openPortal}
          className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-inherit shadow-sm transition hover:bg-white"
        >
          {isPaymentFailed ? "Update billing" : "Add payment method"}
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        className="rounded-full p-1 opacity-70 transition hover:bg-white/60 hover:opacity-100"
        aria-label="Dismiss trial reminder"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function UpgradeNudge() {
  const { isPro } = useSubscription()
  const { showUpgrade } = useUpgradeModal()
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const dismissed = localStorage.getItem(NUDGE_DISMISS_KEY)
    if (dismissed && Date.now() - Number(dismissed) < NUDGE_COOLDOWN_MS) {
      setVisible(false)
    }
  }, [])

  if (isPro || !visible) return null

  function dismiss() {
    localStorage.setItem(NUDGE_DISMISS_KEY, String(Date.now()))
    setVisible(false)
  }

  return (
    <div className="mb-2 rounded-lg border border-brand-tint-strong/80 bg-brand-tint p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-brand-navy">Upgrade</p>
        <button type="button" onClick={dismiss} className="text-brand-navy/45 transition-colors hover:text-brand-navy">
          <span className="text-xs">✕</span>
        </button>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
        Unlock AI cover letters, autofill, resume analysis, and more.
      </p>
      <button
        type="button"
        onClick={() => showUpgrade("resume_upload")}
        className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <Zap className="h-3 w-3" />
        See Pro plans
      </button>
    </div>
  )
}

function PipelineWidget() {
  const [counts, setCounts] = useState<{ active: number; offers: number } | null>(null)

  useEffect(() => {
    fetch("/api/applications/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        setCounts({
          active:
            (data.by_status?.phone_screen ?? 0) +
            (data.by_status?.interview ?? 0) +
            (data.by_status?.final_round ?? 0),
          offers: data.by_status?.offer ?? 0,
        })
      })
      .catch(() => {})
  }, [])

  if (!counts || (counts.active === 0 && counts.offers === 0)) return null

  return (
    <Link
      href="/dashboard/applications"
      className="mx-0 mb-2 block rounded-md border border-brand-tint-strong/80 bg-brand-tint px-3 py-2.5 transition-colors hover:bg-brand-tint-strong/40"
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-navy">Pipeline</p>
      <div className="mt-1.5 flex items-center gap-3">
        {counts.active > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-base font-bold text-brand-navy">{counts.active}</span>
            <span className="text-[11px] text-muted-foreground">active</span>
          </div>
        )}
        {counts.offers > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-base font-bold text-success">{counts.offers}</span>
            <span className="text-[11px] text-muted-foreground">offer{counts.offers !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </Link>
  )
}

const NAV_ITEMS = [
  { label: "Feed", href: "/dashboard", icon: Waves },
  { label: "Applications", href: "/dashboard/applications", icon: Briefcase },
  { label: "Companies", href: "/dashboard/companies", icon: Building2 },
  { label: "Resume", href: "/dashboard/resume", icon: FileText },
  { label: "Cover letters", href: "/dashboard/cover-letters", icon: Scroll },
  { label: "Autofill", href: "/dashboard/autofill", icon: Zap },
  { label: "Watchlist", href: "/dashboard/watchlist", icon: Bookmark },
  { label: "Alerts", href: "/dashboard/alerts", icon: BellRing },
  { label: "Profile", href: "/dashboard/onboarding", icon: UserCircle2 },
]

function getInitials(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.trim() || "Hireoven User"
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

function DashboardSubpageChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, profile, isLoading: authLoading, signOut } = useAuth()
  const { isPro } = useSubscription()

  return (
    <div className="dashboard-subpage min-h-screen">
      <header className="dash-header-bar">
        <div className="mx-auto grid max-w-[1680px] items-center gap-4 px-4 py-3 lg:grid-cols-[252px_minmax(0,1fr)] lg:px-6 xl:grid-cols-[252px_minmax(0,1fr)_280px]">
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center rounded-lg border border-border bg-surface px-3 py-2 transition-colors hover:border-border hover:bg-surface-alt"
            aria-label="Hireoven dashboard home"
          >
            <HireovenLogo className="h-12 w-auto max-w-[190px]" priority />
          </Link>
          <div className="min-w-0">
            <GlobalSearchBar />
          </div>
          <div className="hidden justify-end xl:flex">
            <NotificationBell userId={user?.id} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1680px] px-4 py-4 lg:px-6">
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="soft-scrollbar surface-panel hidden rounded-lg p-3 lg:sticky lg:top-4 lg:block lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
            <div className="flex h-full flex-col">
              <nav className="space-y-0.5">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon
                  const active =
                    item.href === "/dashboard"
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(`${item.href}/`)

                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-colors duration-100",
                        active
                          ? "bg-brand-navy text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                          : "text-muted-foreground hover:bg-surface-alt hover:text-strong"
                      )}
                    >
                      <Icon className={cn("h-[15px] w-[15px] flex-shrink-0", active ? "text-white/90" : "text-muted-foreground")} />
                      {item.label}
                    </Link>
                  )
                })}

                <div className="pt-2">
                  <Link
                    href="/dashboard/international"
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors duration-100 hover:bg-brand-tint hover:text-brand-navy"
                  >
                    <Globe2 className="h-[15px] w-[15px] flex-shrink-0 text-primary" />
                    <span className="flex items-center gap-1.5">
                      International
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    </span>
                  </Link>
                </div>
              </nav>

              <div className="mt-auto pt-4">
                <Link
                  href={isPro ? "/dashboard/billing" : "/dashboard/upgrade"}
                  className={cn(
                    "mb-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-semibold transition-colors duration-100",
                    isPro
                      ? "text-muted-foreground hover:bg-surface-alt hover:text-strong"
                      : "bg-brand-tint text-brand-navy hover:bg-brand-tint-strong/80"
                  )}
                >
                  <CreditCard className={cn("h-[15px] w-[15px] flex-shrink-0", isPro ? "text-muted-foreground" : "text-primary")} />
                  {isPro ? "Billing" : "Upgrade"}
                </Link>
                <UpgradeNudge />
                <PipelineWidget />
                <div className="rounded-lg border border-border bg-surface-alt p-3">
                  <div className="flex items-center gap-2.5">
                    {profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profile.avatar_url}
                        alt={profile.full_name ?? "User avatar"}
                        className="h-9 w-9 rounded-md object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-brand-tint text-xs font-bold text-brand-navy">
                        {getInitials(profile?.full_name, profile?.email)}
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-strong leading-tight">
                        {profile?.full_name || (authLoading ? "…" : "Your profile")}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground mt-0.5">
                        {profile?.email || user?.email || "Signed in"}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-surface-alt hover:text-strong"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          </aside>

          <div className="dashboard-subpage-content min-w-0">{children}</div>
        </div>
      </div>
    </div>
  )
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isMainFeed = pathname === "/dashboard"

  if (isMainFeed) {
    return (
      <>
        <TrialReminderBanner />
        {children}
      </>
    )
  }

  return (
    <>
      <TrialReminderBanner />
      <DashboardSubpageChrome>{children}</DashboardSubpageChrome>
    </>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ResumeProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </ResumeProvider>
  )
}
