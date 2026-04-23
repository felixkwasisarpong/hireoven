"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { X } from "lucide-react"
import DashboardHeader from "@/components/dashboard/DashboardHeader"
import DashboardSidebarNav from "@/components/dashboard/DashboardSidebarNav"
import { ResumeProvider } from "@/components/resume/ResumeProvider"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { cn } from "@/lib/utils"

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
          ? "Your trial has ended - add a payment method to keep your Pro features."
          : urgent
            ? `Your trial ends in ${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"}.`
            : `Pro trial active - ${trialDaysRemaining} days remaining.`}
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

function DashboardSubpageChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-subpage neo-shell relative min-h-screen overflow-hidden xl:flex xl:h-[100dvh] xl:flex-col xl:overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 top-20 h-72 w-72 rounded-full bg-cyan-200/18 blur-3xl animate-hue-float"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-56 h-80 w-80 rounded-full bg-orange-200/16 blur-3xl animate-hue-float"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-amber-200/14 blur-3xl animate-hue-float"
      />
      <DashboardHeader />

      <div className="relative z-10 mx-auto max-w-[1720px] px-4 py-4 lg:px-6 xl:mx-0 xl:flex-1 xl:max-w-none xl:min-h-0 xl:px-0 xl:py-0">
        <div className="grid gap-6 lg:grid-cols-[252px_minmax(0,1fr)] xl:h-full xl:gap-0">
          <aside className="neo-toolbar rounded-[1.1rem] p-3 lg:sticky lg:top-4 lg:self-start lg:flex lg:w-full lg:max-h-[calc(100dvh-5rem)] lg:flex-col lg:overflow-hidden xl:static xl:h-full xl:max-h-none xl:self-auto xl:rounded-none xl:border-y-0 xl:border-l-0 xl:border-r xl:p-4 xl:shadow-none">
            <DashboardSidebarNav />
          </aside>

          <div className="dashboard-subpage-content min-w-0 xl:soft-scrollbar xl:h-full xl:overflow-y-auto xl:px-6 xl:py-5">
            {children}
          </div>
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
      <div className="product-skin">
        <DashboardLayoutInner>{children}</DashboardLayoutInner>
      </div>
    </ResumeProvider>
  )
}
