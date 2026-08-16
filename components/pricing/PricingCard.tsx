"use client"

import { Check } from "lucide-react"
import {
  PLAN_DATA,
  FREE_FEATURES,
  PRO_FEATURES,
  PRO_MAX_FEATURES,
  getSignupUrl,
  type BillingInterval,
  type PlanKey,
} from "@/lib/pricing"
import type { PricingTheme } from "./BillingToggle"

interface PricingCardProps {
  plan: PlanKey
  interval: BillingInterval
  isCurrentPlan: boolean
  onUpgrade: (plan: PlanKey, interval: BillingInterval) => void
  isLoggedIn?: boolean
  userPlan?: PlanKey | null
  theme?: PricingTheme
}

const FEATURES: Record<PlanKey, string[]> = {
  free:    FREE_FEATURES,
  pro:     PRO_FEATURES,
  pro_max: PRO_MAX_FEATURES,
}

type CardStyle = { border: string; bg: string; badgeBg: string; badgeText: string; ctaClass: string; featureAccent: string }

const CARD_STYLES: Record<PlanKey, CardStyle> = {
  free: {
    border: "border-slate-200",
    bg: "bg-white",
    badgeBg: "",
    badgeText: "",
    ctaClass: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300",
    featureAccent: "text-emerald-700",
  },
  pro: {
    border: "border-[#0369A1]/30 ring-1 ring-[#0369A1]/20",
    bg: "bg-white",
    badgeBg: "bg-[#0369A1]",
    badgeText: "text-white",
    ctaClass: "bg-[#0369A1] text-white hover:bg-[#075985] shadow-[0_4px_16px_rgba(3,105,161,0.28)]",
    featureAccent: "text-[#0369A1]",
  },
  pro_max: {
    border: "border-[#ea580c]/20",
    bg: "bg-white",
    badgeBg: "bg-[#ea580c]",
    badgeText: "text-white",
    ctaClass: "bg-[#ea580c] text-white hover:bg-[#c2410c] shadow-[0_4px_16px_rgba(234,88,12,0.24)]",
    featureAccent: "text-[#ea580c]",
  },
}

const TERMINAL_CARD_STYLES: Record<PlanKey, CardStyle> = {
  free: {
    border: "border-[rgba(120,200,160,0.26)]",
    bg: "bg-[#0e1411]",
    badgeBg: "",
    badgeText: "",
    ctaClass: "border border-[rgba(120,200,160,0.26)] text-[#ccd6cf] hover:border-[#38e08a] hover:text-[#38e08a]",
    featureAccent: "text-[#ccd6cf]/60",
  },
  pro: {
    border: "border-[#38e08a]/50",
    bg: "bg-[#0e1411]",
    badgeBg: "bg-[#38e08a]",
    badgeText: "text-[#0a0e0c]",
    ctaClass: "border border-[#38e08a] bg-[#38e08a] text-[#0a0e0c] hover:bg-transparent hover:text-[#38e08a]",
    featureAccent: "text-[#38e08a]",
  },
  pro_max: {
    border: "border-[#f5a623]/50",
    bg: "bg-[#0e1411]",
    badgeBg: "bg-[#f5a623]",
    badgeText: "text-[#0a0e0c]",
    ctaClass: "border border-[#f5a623] bg-[#f5a623] text-[#0a0e0c] hover:bg-transparent hover:text-[#f5a623]",
    featureAccent: "text-[#f5a623]",
  },
}

export default function PricingCard({
  plan,
  interval,
  isCurrentPlan,
  onUpgrade,
  isLoggedIn = false,
  userPlan,
  theme = "app",
}: PricingCardProps) {
  const t = theme === "terminal"
  const data = PLAN_DATA[plan]
  const styles = (t ? TERMINAL_CARD_STYLES : CARD_STYLES)[plan]
  const features = FEATURES[plan]

  const price = interval === "yearly" ? data.yearly : data.monthly
  const monthlyPrice = data.monthly

  function getCtaLabel() {
    if (isCurrentPlan) return "Current plan"
    if (plan === "free" && isLoggedIn) return "Current plan"
    if (plan === "pro" && userPlan === "pro_max") return "Downgrade"
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

  const cardClass = t
    ? `flex h-full flex-col border ${styles.border} ${styles.bg} p-7`
    : `flex h-full flex-col rounded-[22px] border ${styles.border} ${styles.bg} p-7 shadow-[0_1px_0_rgba(15,23,42,0.03),0_6px_20px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_28px_rgba(15,23,42,0.09)]`
  const rounded = t ? "" : "rounded-full"
  const disabledCta = t
    ? "cursor-default border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] text-[#ccd6cf]/40"
    : "cursor-default border border-slate-200 bg-slate-50 text-slate-500"

  return (
    <div className={cardClass}>
      {/* Badge above card */}
      <div className="mb-4 -mt-1 min-h-[26px]">
        <div className="flex flex-wrap items-center gap-2">
          {data.badge && (
            <span className={`inline-flex items-center ${rounded} ${styles.badgeBg} ${styles.badgeText} px-3 py-1 text-[11px] font-bold tracking-wide`}>
              {data.badge}
            </span>
          )}
          {interval === "yearly" && plan !== "free" && (
            <span
              className={
                t
                  ? "pricing-save-badge inline-flex items-center border border-[#f5a623]/25 bg-[#f5a623]/12 px-2.5 py-1 text-[11px] font-bold text-[#f5a623]"
                  : "pricing-save-badge inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700"
              }
            >
              Save 35%
            </span>
          )}
        </div>
      </div>

      {/* Plan name */}
      <p className={`text-[11px] font-bold uppercase tracking-[0.2em] ${t ? "text-[#ccd6cf]/45" : "text-slate-500"}`}>{data.name}</p>

      {/* Price */}
      <div className="mt-3 flex items-end gap-1.5">
        {interval === "yearly" && plan !== "free" && (
          <span className={`mb-1 text-lg font-medium line-through ${t ? "text-[#ccd6cf]/35 tabular-nums" : "text-slate-500"}`}>${monthlyPrice}</span>
        )}
        <span className={`text-4xl tracking-tight ${t ? "font-semibold tabular-nums text-white" : "font-bold text-slate-900"}`}>
          {price === 0 ? "Free" : `$${price}`}
        </span>
        {price > 0 && <span className={`mb-1.5 text-sm ${t ? "text-[#ccd6cf]/45" : "text-slate-500"}`}>/mo</span>}
      </div>

      {/* Yearly billing note */}
      {interval === "yearly" && plan !== "free" && (
        <p className={`mt-0.5 text-xs ${t ? "text-[#ccd6cf]/55 tabular-nums" : "text-slate-500"}`}>
          Billed ${(data as any).yearlyBilled}/year
        </p>
      )}

      {/* Tagline */}
      <p className={`mt-3 text-sm leading-snug ${t ? "text-[#ccd6cf]/65" : "text-slate-500"}`}>{data.tagline}</p>

      {/* CTA */}
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        className={`mt-6 w-full ${rounded ? "rounded-xl" : ""} px-4 py-2.5 text-sm font-semibold transition-all duration-150 ${
          isDisabled ? disabledCta : styles.ctaClass
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
                <p className={`text-xs font-semibold ${t ? "text-[#ccd6cf]/55" : "text-slate-500"}`}>{f}</p>
              ) : (
                <>
                  <Check className={`mt-0.5 h-4 w-4 flex-shrink-0 ${styles.featureAccent}`} strokeWidth={2.5} />
                  <span className={`text-sm leading-snug ${t ? "text-[#ccd6cf]/70" : "text-slate-600"}`}>{f}</span>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
