"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import BillingToggle from "@/components/pricing/BillingToggle"
import PricingCard from "@/components/pricing/PricingCard"
import FeatureRow from "@/components/pricing/FeatureRow"
import { useAuth } from "@/lib/hooks/useAuth"
import { useSubscription } from "@/lib/hooks/useSubscription"
import { type BillingInterval, type PlanKey } from "@/lib/pricing"

const COMPARISON_ROWS: Array<{
  feature: string; free: boolean | string | number; pro: boolean | string | number; proIntl: boolean | string | number; tooltip?: string; isGroupHeader?: boolean
}> = [
  { feature: "Job discovery", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "Match scores", free: false, pro: true, proIntl: true },
  { feature: "Company watchlist", free: "5 max", pro: "Unlimited", proIntl: "Unlimited" },
  { feature: "Job alerts", free: "3 max", pro: "Unlimited", proIntl: "Unlimited" },
  { feature: "Priority sponsor alerts", free: false, pro: false, proIntl: true },
  { feature: "Resume tools", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "Resume upload + AI parsing", free: false, pro: true, proIntl: true },
  { feature: "Gap analysis", free: false, pro: "20/mo", proIntl: "Unlimited" },
  { feature: "Cover letters", free: false, pro: "10/mo", proIntl: "Unlimited" },
  { feature: "Autofill", free: false, pro: true, proIntl: true },
  { feature: "International", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "OPT countdown", free: false, pro: true, proIntl: true },
  { feature: "H1B petition history", free: false, pro: false, proIntl: true },
  { feature: "OPT urgency routing", free: false, pro: false, proIntl: true },
  { feature: "Visa language detection", free: false, pro: false, proIntl: true },
]

type UsageData = {
  cover_letters_used: number
  analyses_used: number
}

export default function UpgradePage() {
  const searchParams = useSearchParams()
  const initialInterval: BillingInterval = searchParams.get("interval") === "yearly" ? "yearly" : "monthly"
  const [interval, setInterval] = useState<BillingInterval>(initialInterval)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState<PlanKey | null>(null)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const autoCheckoutStarted = useRef(false)
  const { user, profile } = useAuth()
  const { plan: currentPlan, isLoading } = useSubscription()

  const isIntlUser = profile?.visa_status || profile?.opt_end_date

  useEffect(() => {
    if (!user) return

    fetch("/api/billing/usage", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setUsage(data)
      })
      .catch(() => {})
  }, [user])

  useEffect(() => {
    if (!user || isLoading || autoCheckoutStarted.current) return
    if (searchParams.get("checkout") !== "1") return

    const requestedPlan = searchParams.get("plan") as PlanKey | null
    if (requestedPlan !== "pro" && requestedPlan !== "pro_international") return

    autoCheckoutStarted.current = true
    void handleUpgrade(requestedPlan, initialInterval)
  }, [initialInterval, isLoading, searchParams, user])

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
          {currentPlan && currentPlan !== "free" && (
            <p className="mt-2 text-sm text-slate-500">
              You&apos;re on <span className="font-semibold capitalize">{currentPlan.replace("_", " ")}</span>. Upgrade for more.
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
                You&apos;ve used <span className="font-semibold text-slate-900">{usage.cover_letters_used}</span> of 10 cover letters.
                <span className="font-medium text-[#FF5C18]"> Upgrade for unlimited.</span>
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
        {!isLoading && (
          <div className="grid gap-6 md:grid-cols-3 mb-16">
            {(["free", "pro", "pro_international"] as PlanKey[]).map((plan) => (
              <PricingCard
                key={plan}
                plan={plan}
                interval={interval}
                isCurrentPlan={currentPlan === plan || (plan === "free" && !currentPlan)}
                onUpgrade={handleUpgrade}
                isLoggedIn={!!user}
                userPlan={currentPlan ?? "free"}
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
                <th className="px-4 py-3.5 text-center text-sm font-semibold text-[#1D4ED8]">Pro Intl.</th>
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row, i) => (
                <FeatureRow key={i} {...row} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
