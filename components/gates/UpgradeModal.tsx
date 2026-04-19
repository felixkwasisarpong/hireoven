"use client"

import { useState } from "react"
import { Check, X, Zap } from "lucide-react"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { FEATURE_DESCRIPTIONS, PLAN_PRICES, type FeatureKey } from "@/lib/gates"

const PRO_FEATURES = [
  "Upload & AI-analyze your resume",
  "AI-generated cover letters",
  "One-click autofill (Greenhouse, Lever, Ashby)",
  "Deep match scoring for every job",
  "AI interview prep questions",
  "Unlimited watchlist companies",
  "Unlimited job alerts",
]

const INTL_FEATURES = [
  "Everything in Pro",
  "International job listings",
  "H-1B / visa sponsorship data",
  "Global salary benchmarks",
]

function PlanCard({
  name,
  price,
  features,
  cta,
  highlighted,
  onSelect,
}: {
  name: string
  price: number
  features: string[]
  cta: string
  highlighted?: boolean
  onSelect: () => void
}) {
  return (
    <div
      className={`flex flex-col rounded-[18px] border p-6 ${
        highlighted
          ? "border-[#FF5C18] bg-[#FFF7F2] shadow-[0_4px_24px_rgba(255,92,24,0.14)]"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">{name}</p>
      <div className="mt-2 flex items-end gap-1">
        <span className="text-3xl font-bold text-slate-900">${price}</span>
        <span className="mb-1 text-sm text-slate-400">/mo</span>
      </div>

      <ul className="mt-5 flex-1 space-y-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-slate-600">
            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
            {f}
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onSelect}
        className={`mt-6 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
          highlighted
            ? "bg-[#FF5C18] text-white hover:bg-[#E14F0E] shadow-[0_4px_14px_rgba(255,92,24,0.3)]"
            : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {cta}
      </button>
    </div>
  )
}

export default function UpgradeModal() {
  const { state, hideUpgrade } = useUpgradeModal()
  const [annual, setAnnual] = useState(true)

  if (!state.open) return null

  const feature = state.feature as FeatureKey | null
  const featureDesc = feature ? FEATURE_DESCRIPTIONS[feature] : null
  const proPrice = annual ? PLAN_PRICES.pro.annual : PLAN_PRICES.pro.monthly
  const intlPrice = annual ? PLAN_PRICES.pro_international.annual : PLAN_PRICES.pro_international.monthly

  function handleSelectPlan(plan: string) {
    window.location.href = `/api/checkout?plan=${plan}&billing=${annual ? "annual" : "monthly"}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={hideUpgrade} />

      <div className="relative w-full max-w-2xl animate-scale-in rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
        <div className="flex items-start justify-between border-b border-slate-100 px-7 py-5">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#FFF1E8]">
                <Zap className="h-4 w-4 text-[#FF5C18]" />
              </div>
              <h2 className="text-lg font-semibold text-slate-900">Upgrade your plan</h2>
            </div>
            {featureDesc && (
              <p className="mt-1 text-sm text-slate-500">
                <span className="font-medium text-[#FF5C18]">{featureDesc}</span> requires a paid plan.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={hideUpgrade}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-7 py-5">
          <div className="mb-5 flex items-center justify-center">
            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setAnnual(false)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  !annual ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setAnnual(true)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  annual ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Annual <span className="ml-1 text-xs text-emerald-600 font-semibold">Save 26%</span>
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <PlanCard
              name="Pro"
              price={proPrice}
              features={PRO_FEATURES}
              cta="Get Pro"
              highlighted
              onSelect={() => handleSelectPlan("pro")}
            />
            <PlanCard
              name="Pro + International"
              price={intlPrice}
              features={INTL_FEATURES}
              cta="Get Pro + International"
              onSelect={() => handleSelectPlan("pro_international")}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
