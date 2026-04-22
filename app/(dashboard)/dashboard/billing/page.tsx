"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, ChevronDown, ExternalLink, Loader2 } from "lucide-react"
import { useSubscription } from "@/lib/hooks/useSubscription"
import FeatureRow from "@/components/pricing/FeatureRow"
import type { BillingInterval, PlanKey } from "@/lib/pricing"

const COMPARISON_ROWS: Array<{
  feature: string; free: boolean | string | number; pro: boolean | string | number; proIntl: boolean | string | number; isGroupHeader?: boolean
}> = [
  { feature: "Job discovery", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "Match scores", free: false, pro: true, proIntl: true },
  { feature: "Watchlist", free: "5 max", pro: "Unlimited", proIntl: "Unlimited" },
  { feature: "Job alerts", free: "3 max", pro: "Unlimited", proIntl: "Unlimited" },
  { feature: "Resume tools", free: "", pro: "", proIntl: "", isGroupHeader: true },
  { feature: "Cover letters", free: false, pro: "10/mo", proIntl: "Unlimited" },
  { feature: "Deep analyses", free: false, pro: "20/mo", proIntl: "Unlimited" },
]

interface UsageData {
  cover_letters_used: number
  analyses_used: number
}

interface BillingInfo {
  plan: string
  status: string
  currentPeriodEnd: string | null
  billingInterval: BillingInterval | null
  amountCents: number | null
  cancelAtPeriodEnd: boolean
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  pro_international: "Pro International",
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: "Active", color: "bg-slate-100 text-slate-600" },
  active: { label: "Active", color: "bg-emerald-50 text-emerald-700" },
  trialing: { label: "Trial", color: "bg-[#FFF1E8] text-[#9A3412]" },
  canceled: { label: "Canceled", color: "bg-red-50 text-red-700" },
  past_due: { label: "Past due", color: "bg-red-50 text-red-700" },
}

export default function BillingPage() {
  const searchParams = useSearchParams()
  const {
    plan,
    status: subscriptionStatus,
    currentPeriodEnd,
    billingInterval,
    amountCents,
    cancelAtPeriodEnd,
    isLoading: subLoading,
  } = useSubscription()
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [portalLoading, setPortalLoading] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [feedbackReason, setFeedbackReason] = useState("")
  const [feedbackDetails, setFeedbackDetails] = useState("")
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)

  useEffect(() => {
    fetch("/api/subscription")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!data) return
        setBilling(data)
      })
      .catch(() => {})

    fetch("/api/billing/usage")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => data && setUsage(data))
      .catch(() => {})
  }, [])

  async function openPortal() {
    setPortalLoading(true)
    const res = await fetch("/api/stripe/portal", { method: "POST" })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setPortalLoading(false)
  }

  async function startCheckout(targetPlan: PlanKey, targetInterval: BillingInterval = "monthly") {
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: targetPlan, interval: targetInterval }),
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  async function submitCancellationFeedback() {
    await fetch("/api/subscription/cancel-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: feedbackReason, details: feedbackDetails }),
    })
    setFeedbackSubmitted(true)
  }

  if (subLoading) {
    return (
      <div className="app-page flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  const currentPlan = billing?.plan ?? plan ?? "free"
  const status = billing?.status ?? subscriptionStatus ?? "free"
  const resolvedInterval = billing?.billingInterval ?? billingInterval ?? "monthly"
  const resolvedAmountCents = billing?.amountCents ?? amountCents
  const resolvedCancelAtPeriodEnd = billing?.cancelAtPeriodEnd ?? cancelAtPeriodEnd
  const isPro = currentPlan === "pro" || currentPlan === "pro_international"
  const periodEndSource = billing?.currentPeriodEnd ?? currentPeriodEnd
  const periodEnd = periodEndSource
    ? new Date(periodEndSource).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null

  const statusMeta = STATUS_LABELS[status] ?? STATUS_LABELS["free"]
  const amountLabel =
    typeof resolvedAmountCents === "number" && resolvedAmountCents > 0
      ? `$${(resolvedAmountCents / 100).toFixed(0)}`
      : "$0"
  const returnedFromPortal = searchParams.get("portal") === "return"

  return (
    <div className="app-page">
      <div className="app-shell max-w-2xl">
        <div className="mb-6">
          <Link href="/dashboard" className="subpage-back">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </div>

        <div className="mb-8">
          <p className="section-kicker mb-1">Billing</p>
          <h1 className="text-2xl font-bold text-slate-900">Your plan</h1>
        </div>

        {/* Current plan */}
        <div className="surface-card p-6 mb-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl font-bold text-slate-900">
                  {PLAN_LABELS[currentPlan] ?? currentPlan}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusMeta.color}`}>
                  {statusMeta.label}
                </span>
              </div>
              {periodEnd && (
                <p className="text-sm text-slate-500">
                  {status === "trialing" ? "Trial ends" : status === "canceled" || resolvedCancelAtPeriodEnd ? "Access until" : "Renews"}{" "}
                  <span className="font-medium text-slate-700">{periodEnd}</span>
                </p>
              )}
              <p className="mt-1 text-sm text-slate-500">
                {resolvedInterval === "yearly" ? "Yearly billing" : "Monthly billing"} ·{" "}
                <span className="font-medium text-slate-700">
                  {amountLabel}{isPro ? (resolvedInterval === "yearly" ? "/year" : "/month") : ""}
                </span>
              </p>
            </div>

            {isPro && (
              <button
                type="button"
                onClick={openPortal}
                disabled={portalLoading}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                Manage billing
              </button>
            )}
          </div>

          {/* Usage meters - pro only */}
          {isPro && usage && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 border-t border-slate-100 pt-5">
              <UsageMeter
                label="Cover letters"
                used={usage.cover_letters_used}
                limit={currentPlan === "pro_international" ? null : 10}
              />
              <UsageMeter
                label="Deep analyses"
                used={usage.analyses_used}
                limit={currentPlan === "pro_international" ? null : 20}
              />
            </div>
          )}
        </div>

        {isPro && (
          <div className="surface-card p-6 mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-900">Billing options</p>
              <p className="text-sm text-slate-500 mt-0.5">
                {resolvedInterval === "yearly"
                  ? "You are already saving with yearly billing."
                  : "Switch to yearly billing and save 35%."}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                startCheckout(
                  currentPlan === "pro_international" ? "pro_international" : "pro",
                  resolvedInterval === "yearly" ? "monthly" : "yearly"
                )
              }
              className="flex-shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {resolvedInterval === "yearly" ? "Switch to monthly" : "Switch to yearly - save 35%"}
            </button>
          </div>
        )}

        {(resolvedCancelAtPeriodEnd || status === "canceled" || returnedFromPortal) && isPro && (
          <div className="surface-card mb-5 border-red-100 bg-red-50/40 p-6">
            <p className="text-sm font-semibold text-red-800">Before you go</p>
            <p className="mt-1 text-sm text-red-700/80">
              You&apos;ll lose AI resume tools, autofill, match scoring, and unlimited alerts when this plan ends.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openPortal}
                className="rounded-xl bg-[#FF5C18] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
              >
                Keep my plan
              </button>
            </div>

            {!feedbackSubmitted ? (
              <div className="mt-5 border-t border-red-100 pt-5">
                <p className="text-sm font-semibold text-slate-900">Help us improve - why are you canceling?</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {["Too expensive", "Not finding jobs", "Missing a feature", "Found another tool", "Other"].map((reason) => (
                    <button
                      key={reason}
                      type="button"
                      onClick={() => setFeedbackReason(reason)}
                      className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                        feedbackReason === reason
                          ? "border-[#FF5C18] bg-[#FFF1E8] text-[#9A3412]"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {reason}
                    </button>
                  ))}
                </div>
                <textarea
                  value={feedbackDetails}
                  onChange={(event) => setFeedbackDetails(event.target.value)}
                  placeholder="Anything else we should know?"
                  className="mt-3 min-h-24 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FFD2B8]"
                />
                <button
                  type="button"
                  onClick={submitCancellationFeedback}
                  className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Submit feedback
                </button>
              </div>
            ) : (
              <p className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
                Feedback recorded. Your plan remains active until {periodEnd ?? "the end of the billing period"}.
              </p>
            )}
          </div>
        )}

        {/* CTAs based on plan */}
        {currentPlan === "free" && (
          <div className="surface-card p-6 mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-900">Upgrade to Pro</p>
              <p className="text-sm text-slate-500 mt-0.5">
                AI tools, unlimited alerts, autofill, and more
              </p>
            </div>
            <button
              type="button"
              onClick={() => startCheckout("pro")}
              className="flex-shrink-0 rounded-xl bg-[#0369A1] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985] shadow-[0_4px_14px_rgba(3,105,161,0.2)]"
            >
              Start Pro trial
            </button>
          </div>
        )}

        {currentPlan === "pro" && (
          <div className="surface-card p-6 mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-900">Upgrade to Pro International</p>
              <p className="text-sm text-slate-500 mt-0.5">
                Unlimited cover letters, H1B intel, OPT urgency routing
              </p>
            </div>
            <button
              type="button"
              onClick={() => startCheckout("pro_international", resolvedInterval)}
              className="flex-shrink-0 rounded-xl bg-[#1D4ED8] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1E40AF]"
            >
              Upgrade
            </button>
          </div>
        )}

        {/* Comparison toggle */}
        <div className="surface-card overflow-hidden mb-5">
          <button
            type="button"
            onClick={() => setCompareOpen(!compareOpen)}
            className="flex w-full items-center justify-between px-6 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            Compare plans
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${compareOpen ? "rotate-180" : ""}`} />
          </button>
          {compareOpen && (
            <table className="w-full border-t border-slate-100">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-1/2">Feature</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Free</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#0369A1] uppercase tracking-wide bg-[#F0FDFA]/60">Pro</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-[#1D4ED8] uppercase tracking-wide">Pro Intl.</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row, i) => (
                  <FeatureRow key={i} {...row} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-center text-xs text-slate-400">
          Questions? Email us at{" "}
          <a href="mailto:support@hireoven.com" className="text-[#0369A1] hover:underline">
            support@hireoven.com
          </a>
        </p>
      </div>
    </div>
  )
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const isNearLimit = limit && pct >= 80

  return (
    <div className="rounded-[12px] border border-slate-200/70 bg-slate-50/60 p-3.5">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <p className="text-xs text-slate-700 font-medium">
          {limit ? `${used} / ${limit}` : `${used} / ∞`}
        </p>
      </div>
      {limit && (
        <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${isNearLimit ? "bg-amber-500" : "bg-[#0369A1]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {!limit && (
        <p className="text-xs text-emerald-600 font-medium">Unlimited</p>
      )}
    </div>
  )
}
