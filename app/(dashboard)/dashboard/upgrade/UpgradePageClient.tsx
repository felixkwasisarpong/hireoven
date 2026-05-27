"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import BillingToggle from "@/components/pricing/BillingToggle"
import PricingCard from "@/components/pricing/PricingCard"
import FeatureRow from "@/components/pricing/FeatureRow"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { useFeatureFlags } from "@/lib/hooks/useFeatureFlags"
import { PLAN_COMPARISON_ROWS, type BillingInterval, type PlanKey } from "@/lib/pricing"

type UsageData = {
  cover_letters_used: number
  analyses_used: number
}

type UpgradePageClientProps = {
  initialInterval?: BillingInterval
  initialUsage?: UsageData | null
  initialUsageLoaded?: boolean
  initialPlan?: PlanKey | null
  initialPlanLoaded?: boolean
  initialIsIntlUser?: boolean
  initialAutoCheckoutPlan?: PlanKey | null
  initialShouldAutoCheckout?: boolean
}

function normalizeUiPlan(plan: string | null | undefined): PlanKey | "free" {
  if (plan === "pro_international") return "pro_max"
  if (plan === "pro" || plan === "pro_max") return plan
  return "free"
}

export default function UpgradePageClient({
  initialInterval = "monthly",
  initialUsage = null,
  initialUsageLoaded = false,
  initialPlan = null,
  initialPlanLoaded = false,
  initialIsIntlUser = false,
  initialAutoCheckoutPlan = null,
  initialShouldAutoCheckout = false,
}: UpgradePageClientProps) {
  const [interval, setInterval] = useState<BillingInterval>(initialInterval)
  const [usage, setUsage] = useState<UsageData | null>(initialUsage)
  const [usageLoaded, setUsageLoaded] = useState(initialUsageLoaded)
  const [checkoutLoading, setCheckoutLoading] = useState<PlanKey | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const autoCheckoutStarted = useRef(false)
  const { user, profile } = useAuth()
  const { plan: currentPlan, isLoading } = useSubscription()
  const { paymentsDisabled } = useFeatureFlags()

  const isIntlUser =
    profile?.is_international ||
    profile?.visa_status ||
    profile?.needs_sponsorship ||
    initialIsIntlUser
  const resolvedPlan = normalizeUiPlan(currentPlan ?? initialPlan ?? "free")

  useEffect(() => {
    if (!user || usageLoaded) return

    fetch("/api/billing/usage", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setUsage(data)
      })
      .catch(() => {})
      .finally(() => setUsageLoaded(true))
  }, [usageLoaded, user])

  useEffect(() => {
    if (!user || isLoading || autoCheckoutStarted.current) return
    if (!initialShouldAutoCheckout) return
    if (initialAutoCheckoutPlan !== "pro" && initialAutoCheckoutPlan !== "pro_max") return

    autoCheckoutStarted.current = true
    void handleUpgrade(initialAutoCheckoutPlan, initialInterval)
  }, [initialAutoCheckoutPlan, initialInterval, initialShouldAutoCheckout, isLoading, user])

  async function handleUpgrade(plan: PlanKey, bil: BillingInterval) {
    if (plan === "free") return
    setCheckoutLoading(plan)
    setCheckoutError(null)

    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval: bil }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.url) window.location.href = data.url
    else {
      setCheckoutError(data.error ?? "Could not start checkout. Please try again.")
      setCheckoutLoading(null)
    }
  }

  if (paymentsDisabled) {
    return (
      <div className="app-page">
        <div className="app-shell max-w-2xl">
          <div className="mb-6">
            <Link href="/dashboard" className="subpage-back">
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to dashboard
            </Link>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-amber-900">
            <h1 className="text-xl font-semibold">Payments are temporarily paused</h1>
            <p className="mt-2 text-sm leading-relaxed">
              We&apos;re not accepting new upgrades right now. Your existing
              access is unaffected — check back soon.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app-page">
      <div className="app-shell max-w-4xl">
        <div className="mb-6">
          <Link href="/dashboard" className="subpage-back">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </div>

        {/* Hero */}
        <div className="mb-10 text-center">
          <p className="section-kicker mb-2">Plans & pricing</p>
          <h1 className="section-title">
            {isIntlUser
              ? "Unlock everything built for international candidates"
              : "Unlock the full Hireoven experience"}
          </h1>
          {resolvedPlan && resolvedPlan !== "free" && (
            <p className="mt-2 text-sm text-slate-500">
              You&apos;re on{" "}
              <span className="font-semibold">
                {resolvedPlan === "pro_max" ? "Pro Max" : resolvedPlan === "pro" ? "Pro" : resolvedPlan}
              </span>. Upgrade for more.
            </p>
          )}
        </div>

        <div className="mb-8">
          <BillingToggle value={interval} onChange={setInterval} />
        </div>

        {checkoutError && (
          <div className="mx-auto mb-6 max-w-2xl rounded-[14px] border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {checkoutError}
          </div>
        )}

        {checkoutLoading && (
          <div className="mx-auto mb-6 flex max-w-2xl items-center justify-center gap-2 rounded-[14px] border border-[#FFD2B8] bg-[#FFF7F2] px-4 py-3 text-sm font-medium text-[#9A3412]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Opening secure checkout…
          </div>
        )}

        {usage && (
          <div className="mb-8 grid gap-3 md:grid-cols-2">
            <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Usage this month</p>
              <p className="mt-1 text-sm text-slate-600">
                You&apos;ve used <span className="font-semibold text-slate-900">{usage.cover_letters_used}</span> of 25 cover letters this month.
                <span className="font-medium text-[#FF5C18]"> Upgrade to Pro Max for unlimited.</span>
              </p>
            </div>
            <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Deep analysis</p>
              <p className="mt-1 text-sm text-slate-600">
                You&apos;ve used <span className="font-semibold text-slate-900">{usage.analyses_used}</span> of 20 deep analyses.
                <span className="font-medium text-[#FF5C18]"> Upgrade for more.</span>
              </p>
            </div>
          </div>
        )}

        {/* Cards */}
        {(!isLoading || initialPlanLoaded) && (
          <div className="grid gap-6 md:grid-cols-3 mb-16">
            {(["free", "pro", "pro_max"] as PlanKey[]).map((plan) => (
              <PricingCard
                key={plan}
                plan={plan}
                interval={interval}
                isCurrentPlan={resolvedPlan === plan || (plan === "free" && !resolvedPlan)}
                onUpgrade={handleUpgrade}
                isLoggedIn={!!user}
                userPlan={resolvedPlan}
              />
            ))}
          </div>
        )}

        {/* Comparison table */}
        <div className="surface-card overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Feature comparison</h2>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 py-3.5 text-left text-sm font-semibold text-slate-700 w-1/2">Feature</th>
                <th className="px-4 py-3.5 text-center text-sm font-semibold text-slate-700">Free</th>
                <th className="px-4 py-3.5 text-center text-sm font-semibold text-[#0369A1] bg-[#F0FDFA]/60">Pro</th>
                <th className="px-4 py-3.5 text-center text-sm font-semibold text-[#ea580c]">Pro Max</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_COMPARISON_ROWS.map((row, i) => (
                <FeatureRow key={i} {...row} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
