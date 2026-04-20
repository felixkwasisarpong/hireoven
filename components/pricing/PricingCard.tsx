"use client"

import { Check } from "lucide-react"
import {
  PLAN_DATA,
  FREE_FEATURES,
  PRO_FEATURES,
  PRO_INTL_FEATURES,
  getSignupUrl,
  type BillingInterval,
  type PlanKey,
} from "@/lib/pricing"

interface PricingCardProps {
  plan: PlanKey
  interval: BillingInterval
  isCurrentPlan: boolean
  onUpgrade: (plan: PlanKey, interval: BillingInterval) => void
  isLoggedIn?: boolean
  userPlan?: PlanKey | null
}

const FEATURES: Record<PlanKey, string[]> = {
  free: FREE_FEATURES,
  pro: PRO_FEATURES,
  pro_international: PRO_INTL_FEATURES,
}

const CARD_STYLES: Record<PlanKey, { border: string; bg: string; badgeBg: string; badgeText: string; ctaClass: string; featureAccent: string }> = {
  free: {
    border: "border-slate-200",
    bg: "bg-white",
    badgeBg: "",
    badgeText: "",
    ctaClass: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300",
    featureAccent: "text-emerald-500",
  },
  pro: {
    border: "border-[#0369A1]/30 ring-1 ring-[#0369A1]/20",
    bg: "bg-white",
    badgeBg: "bg-[#0369A1]",
    badgeText: "text-white",
    ctaClass: "bg-[#0369A1] text-white hover:bg-[#075985] shadow-[0_4px_16px_rgba(3,105,161,0.28)]",
    featureAccent: "text-[#0369A1]",
  },
  pro_international: {
    border: "border-[#1D4ED8]/20",
    bg: "bg-white",
    badgeBg: "bg-[#1D4ED8]",
    badgeText: "text-white",
    ctaClass: "bg-[#1D4ED8] text-white hover:bg-[#1E40AF] shadow-[0_4px_16px_rgba(29,78,216,0.24)]",
    featureAccent: "text-[#1D4ED8]",
  },
}

export default function PricingCard({
  plan,
  interval,
  isCurrentPlan,
  onUpgrade,
  isLoggedIn = false,
  userPlan,
}: PricingCardProps) {
  const data = PLAN_DATA[plan]
  const styles = CARD_STYLES[plan]
  const features = FEATURES[plan]

  const price = interval === "yearly" ? data.yearly : data.monthly
  const monthlyPrice = data.monthly

  function getCtaLabel() {
    if (isCurrentPlan) return "Current plan"
    if (plan === "free" && isLoggedIn) return "Current plan"
    if (plan === "pro" && userPlan === "pro_international") return "Downgrade"
    return data.cta
  }

  const ctaLabel = getCtaLabel()
  const isDisabled = isCurrentPlan || (plan === "free" && isLoggedIn)

  function handleClick() {
    if (isDisabled) return
    if (!isLoggedIn) {
      window.location.href = getSignupUrl(plan, interval)
      return
    }
    onUpgrade(plan, interval)
  }

  return (
    <div
      className={`flex h-full flex-col rounded-[22px] border ${styles.border} ${styles.bg} p-7 shadow-[0_1px_0_rgba(15,23,42,0.03),0_6px_20px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(15,23,42,0.09)]`}
    >
      {/* Badge above card */}
      <div className="mb-4 -mt-1 min-h-[26px]">
        <div className="flex flex-wrap items-center gap-2">
          {data.badge && (
            <span className={`inline-flex items-center rounded-full ${styles.badgeBg} ${styles.badgeText} px-3 py-1 text-[11px] font-bold tracking-wide`}>
              {data.badge}
            </span>
          )}
          {interval === "yearly" && plan !== "free" && (
            <span className="pricing-save-badge inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
              Save 35%
            </span>
          )}
        </div>
      </div>

      {/* Plan name */}
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{data.name}</p>

      {/* Price */}
      <div className="mt-3 flex items-end gap-1.5">
        {interval === "yearly" && plan !== "free" && (
          <span className="mb-1 text-lg font-medium text-slate-300 line-through">${monthlyPrice}</span>
        )}
        <span className="text-4xl font-bold tracking-tight text-slate-900">
          {price === 0 ? "Free" : `$${price}`}
        </span>
        {price > 0 && <span className="mb-1.5 text-sm text-slate-400">/mo</span>}
      </div>

      {/* Yearly billing note */}
      {interval === "yearly" && plan !== "free" && (
        <p className="mt-0.5 text-xs text-slate-500">
          Billed ${(data as any).yearlyBilled}/year
        </p>
      )}

      {/* Tagline */}
      <p className="mt-3 text-sm text-slate-500 leading-snug">{data.tagline}</p>

      {/* CTA */}
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        className={`mt-6 w-full rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-150 ${
          isDisabled
            ? "cursor-default border border-slate-200 bg-slate-50 text-slate-400"
            : styles.ctaClass
        }`}
      >
        {ctaLabel}
      </button>

      {/* Features */}
      <ul className="mt-6 space-y-2.5">
        {features.map((f, i) => {
          const isHeader = f.endsWith(":")
          return (
            <li key={i} className={isHeader ? "pt-1" : "flex items-start gap-2.5"}>
              {isHeader ? (
                <p className="text-xs font-semibold text-slate-500">{f}</p>
              ) : (
                <>
                  <Check className={`mt-0.5 h-4 w-4 flex-shrink-0 ${styles.featureAccent}`} strokeWidth={2.5} />
                  <span className="text-sm text-slate-600 leading-snug">{f}</span>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
