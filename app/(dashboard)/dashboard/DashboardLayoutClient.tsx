"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { X } from "lucide-react"
import DashboardHeader from "@/components/dashboard/DashboardHeader"
import { DashboardMobileNavProvider } from "@/components/dashboard/DashboardMobileNav"
import DashboardProductTour from "@/components/dashboard/DashboardProductTour"
import DashboardSubpageSidebar from "@/components/dashboard/DashboardSubpageSidebar"
import SavedJobReminderPopup from "@/components/apex/SavedJobReminderPopup"
import InterviewReminderWatcher from "@/components/interview/InterviewReminderWatcher"
import PurchaseVerifier from "@/components/billing/PurchaseVerifier"
import LaunchPromoPopup from "@/components/apex/LaunchPromoPopup"
import { ResumeProvider } from "@/components/resume/ResumeProvider"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { cn } from "@/lib/utils"

const BILLING_BANNER_DISMISS_KEY = "billing_banner_dismissed_at"

function BillingReminderBanner() {
  const { status, isPro } = useSubscription()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const dismissedAt = localStorage.getItem(BILLING_BANNER_DISMISS_KEY)
    if (dismissedAt && Date.now() - Number(dismissedAt) < 24 * 60 * 60 * 1000) {
      setDismissed(true)
    }
  }, [])

  if (dismissed || !isPro) return null

  const isPaymentFailed = status === "past_due" || status === "unpaid"

  if (!isPaymentFailed) return null

  async function openPortal() {
    const response = await fetch("/api/stripe/portal", { method: "POST" })
    const data = await response.json().catch(() => ({}))
    if (data.url) window.location.href = data.url
  }

  function dismiss() {
    localStorage.setItem(BILLING_BANNER_DISMISS_KEY, String(Date.now()))
    setDismissed(true)
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-3 px-4 py-2 text-sm font-medium",
        "border-b border-red-200 bg-red-50 text-red-800"
      )}
    >
      <span>Your payment needs attention - update billing to keep your Pro features.</span>
      <button
        type="button"
        onClick={openPortal}
        className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-inherit shadow-sm transition hover:bg-white"
      >
        Update billing
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="rounded-full p-1 opacity-70 transition hover:bg-white/60 hover:opacity-100"
        aria-label="Dismiss billing reminder"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

function DashboardSubpageChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="dashboard-subpage relative min-h-[100dvh] w-full bg-white xl:flex xl:h-[100dvh] xl:overflow-hidden">
      <DashboardSubpageSidebar />

      <div className="flex min-w-0 flex-1 flex-col xl:h-full xl:overflow-hidden">
        <DashboardHeader />
        <div className="dashboard-subpage-content min-w-0 flex-1 xl:soft-scrollbar xl:overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  )
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isMainFeed = pathname === "/dashboard"
  const isImmersiveInterviewRoom =
    pathname.startsWith("/dashboard/interview/live/") ||
    pathname.startsWith("/dashboard/interview/coding/")

  if (isImmersiveInterviewRoom) {
    return children
  }

  if (isMainFeed) {
    return (
      <>
        <BillingReminderBanner />
        {children}
      </>
    )
  }

  return (
    <>
      <BillingReminderBanner />
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
      <DashboardMobileNavProvider>
        <div className="product-skin">
          <DashboardLayoutInner>{children}</DashboardLayoutInner>
          <DashboardProductTour />
          <SavedJobReminderPopup />
          <InterviewReminderWatcher />
          <PurchaseVerifier />
          <LaunchPromoPopup />
        </div>
      </DashboardMobileNavProvider>
    </ResumeProvider>
  )
}
