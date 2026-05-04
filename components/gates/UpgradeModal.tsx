"use client"

import { useState } from "react"
import { Check, Loader2, Sparkles, X, Zap } from "lucide-react"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { FEATURE_DESCRIPTIONS, type FeatureKey } from "@/lib/gates"
import type { BillingInterval, PlanKey } from "@/lib/pricing"

// ── Plan definitions ──────────────────────────────────────────────────────────

const PLANS = [
  {
    key: "pro" as PlanKey,
    name: "Pro",
    monthly: 19,
    yearly: 12,
    yearlyBilled: 149,
    badge: null,
    highlighted: true,
    color: { from: "#FF5C18", to: "#FF9A3C" },
    features: [
      "Scout AI — 50 messages/day",
      "Resume tailoring — 10/month",
      "Cover letter generator — 15/month",
      "Deep resume analysis — 20/month",
      "AI interview prep",
      "Application autofill",
      "Unlimited watchlist & alerts",
      "Full application tracker",
    ],
  },
  {
    key: "pro_international" as PlanKey,
    name: "Max",
    monthly: 39,
    yearly: 25,
    yearlyBilled: 299,
    badge: "Best value",
    highlighted: false,
    color: { from: "#7C3AED", to: "#C026D3" },
    features: [
      "Scout AI — unlimited",
      "Resume tailoring — unlimited",
      "Cover letters — unlimited",
      "Deep analysis — unlimited",
      "Mock interviews — unlimited",
      "Bulk apply agent",
      "Everything in Pro",
    ],
  },
] as const

// ── Subcomponents ─────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  annual,
  loading,
  onSelect,
}: {
  plan: typeof PLANS[number]
  annual: boolean
  loading: boolean
  onSelect: () => void
}) {
  const price = annual ? plan.yearly : plan.monthly

  return (
    <div className={[
      "relative flex flex-col overflow-hidden rounded-2xl border transition",
      plan.highlighted
        ? "border-[#FF5C18]/40 bg-white shadow-[0_8px_32px_rgba(255,92,24,0.12)]"
        : "border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.06)]",
    ].join(" ")}>
      {/* Top accent bar */}
      <div
        className="h-1 w-full"
        style={{ background: `linear-gradient(90deg, ${plan.color.from}, ${plan.color.to})` }}
      />

      {/* Badge */}
      {plan.badge && (
        <div className="absolute right-4 top-3">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
            style={{ background: `linear-gradient(135deg, ${plan.color.from}, ${plan.color.to})` }}
          >
            <Sparkles className="h-2.5 w-2.5" />
            {plan.badge}
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col p-5">
        {/* Name + price */}
        <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-slate-400">{plan.name}</p>
        <div className="mt-2 flex items-end gap-1">
          <span className="text-[32px] font-black leading-none tabular-nums text-slate-900">${price}</span>
          <span className="mb-1.5 text-[13px] text-slate-400">/mo</span>
        </div>
        {annual && (
          <p className="mt-0.5 text-[11px] text-slate-400">
            Billed <span className="font-semibold text-slate-600">${plan.yearlyBilled}/yr</span>
          </p>
        )}

        {/* Features */}
        <ul className="mt-5 flex-1 space-y-2">
          {plan.features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                style={{ background: `${plan.color.from}18` }}
              >
                <Check className="h-2.5 w-2.5" style={{ color: plan.color.from }} strokeWidth={3} />
              </span>
              <span className="text-[12.5px] text-slate-600">{f}</span>
            </li>
          ))}
        </ul>

        {/* CTA */}
        <button
          type="button"
          onClick={onSelect}
          disabled={loading}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-bold text-white shadow-sm transition disabled:opacity-70"
          style={{
            background: `linear-gradient(135deg, ${plan.color.from}, ${plan.color.to})`,
            boxShadow: `0 4px 14px ${plan.color.from}40`,
          }}
        >
          {loading ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening checkout…</>
          ) : (
            <>Get {plan.name} <span className="opacity-80">→</span></>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function UpgradeModal() {
  const { state, hideUpgrade } = useUpgradeModal()
  const [annual, setAnnual] = useState(true)
  const [loadingPlan, setLoadingPlan] = useState<PlanKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!state.open) return null

  const feature = state.feature as FeatureKey | null
  const featureDesc = feature ? FEATURE_DESCRIPTIONS[feature] : null
  const interval: BillingInterval = annual ? "yearly" : "monthly"

  async function handleSelectPlan(plan: PlanKey) {
    setLoadingPlan(plan)
    setError(null)
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval }),
    })
    const data = await res.json().catch(() => ({}))
    if (data.url) { window.location.href = data.url; return }
    setError(data.error ?? "Could not start checkout. Please try again.")
    setLoadingPlan(null)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-[3px]"
        onClick={hideUpgrade}
      />

      {/* Modal */}
      <div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.22)]">

        {/* Header */}
        <div className="relative overflow-hidden border-b border-slate-100 px-6 py-5"
          style={{ background: "linear-gradient(135deg, #FFF4EE 0%, #F9F8FF 60%, #F3F4FF 100%)" }}>
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#FF5C18]/8 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-4 left-1/3 h-20 w-20 rounded-full bg-violet-500/8 blur-xl" />

          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF5C18] to-[#FF9A3C] shadow-[0_4px_10px_rgba(255,92,24,0.3)]">
                  <Zap className="h-3.5 w-3.5 text-white" strokeWidth={2.5} />
                </div>
                <h2 className="text-[16px] font-bold text-slate-900">Unlock premium features</h2>
              </div>
              {featureDesc ? (
                <p className="mt-1.5 text-[12.5px] text-slate-500">
                  <span className="font-semibold text-[#FF5C18]">{featureDesc}</span>{" "}
                  is a paid feature — pick a plan to continue.
                </p>
              ) : (
                <p className="mt-1.5 text-[12.5px] text-slate-500">
                  Upgrade to unlock AI-powered tools, unlimited usage, and more.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={hideUpgrade}
              className="shrink-0 rounded-xl p-1.5 text-slate-400 transition hover:bg-white/80 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Billing toggle */}
          <div className="relative mt-4 flex items-center justify-center">
            <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-white/80 p-1 shadow-sm">
              <button
                type="button"
                onClick={() => setAnnual(false)}
                className={[
                  "rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition",
                  !annual ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setAnnual(true)}
                className={[
                  "rounded-full px-4 py-1.5 text-[12.5px] font-semibold transition",
                  annual ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:text-slate-700",
                ].join(" ")}
              >
                Annual
                <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                  −35%
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-2 gap-3 p-5">
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              annual={annual}
              loading={loadingPlan === plan.key}
              onSelect={() => handleSelectPlan(plan.key)}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-[12.5px] text-red-700">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-3 text-center">
          <p className="text-[11px] text-slate-400">
            7-day free trial · Cancel anytime · Secure checkout via Stripe
          </p>
        </div>
      </div>
    </div>
  )
}
