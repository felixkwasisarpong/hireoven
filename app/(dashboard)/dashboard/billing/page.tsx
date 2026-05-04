"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Globe2,
  Loader2,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react"
import { useSubscription } from "@/lib/hooks/useSubscription"
import FeatureRow from "@/components/pricing/FeatureRow"
import { cn } from "@/lib/utils"
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

const PLAN_TAGLINES: Record<string, string> = {
  free: "Browse the live job feed and track applications.",
  pro: "AI tools, unlimited alerts, autofill, and deep analyses.",
  pro_international: "Everything in Pro plus H1B intel and OPT urgency routing.",
}

const STATUS_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  free:      { label: "Active",   color: "bg-slate-100 text-slate-600",       dot: "bg-slate-400" },
  active:    { label: "Active",   color: "bg-emerald-50 text-emerald-700",    dot: "bg-emerald-500" },
  trialing:  { label: "Trial",    color: "bg-amber-50 text-amber-700",        dot: "bg-amber-500" },
  canceled:  { label: "Canceled", color: "bg-rose-50 text-rose-700",          dot: "bg-rose-500" },
  past_due:  { label: "Past due", color: "bg-rose-50 text-rose-700",          dot: "bg-rose-500" },
}

function planAccent(plan: string) {
  if (plan === "pro_international") {
    return {
      gradient: "from-orange-500 via-rose-500 to-pink-500",
      ring: "ring-orange-200",
      tint: "bg-orange-50",
      icon: Globe2,
      iconColor: "text-orange-600",
    }
  }
  if (plan === "pro") {
    return {
      gradient: "from-sky-500 via-indigo-500 to-violet-500",
      ring: "ring-sky-200",
      tint: "bg-sky-50",
      icon: Sparkles,
      iconColor: "text-sky-600",
    }
  }
  return {
    gradient: "from-slate-400 via-slate-500 to-slate-600",
    ring: "ring-slate-200",
    tint: "bg-slate-50",
    icon: ShieldCheck,
    iconColor: "text-slate-500",
  }
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
  const accent = planAccent(currentPlan)
  const PlanIcon = accent.icon
  const amountLabel =
    typeof resolvedAmountCents === "number" && resolvedAmountCents > 0
      ? `$${(resolvedAmountCents / 100).toFixed(0)}`
      : "$0"
  const renewLabel =
    status === "trialing"
      ? "Trial ends"
      : status === "canceled" || resolvedCancelAtPeriodEnd
        ? "Access until"
        : "Renews"
  const returnedFromPortal = searchParams.get("portal") === "return"

  return (
    <div className="app-page">
      <div className="app-shell max-w-3xl">
        <div className="mb-6">
          <Link href="/dashboard" className="subpage-back">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to dashboard
          </Link>
        </div>

        <header className="mb-8">
          <p className="section-kicker mb-1.5">Settings</p>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Plan & billing</h1>
          <p className="mt-2 text-[15px] text-slate-500">
            Manage your subscription, usage, and billing preferences.
          </p>
        </header>

        {/* ── Hero plan card ── */}
        <section className="relative mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
          <div className={cn("h-1 w-full bg-gradient-to-r", accent.gradient)} />
          <div className="p-6 sm:p-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-4">
                <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ring-1", accent.tint, accent.ring)}>
                  <PlanIcon className={cn("h-6 w-6", accent.iconColor)} aria-hidden />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-2xl font-bold text-slate-900">
                      {PLAN_LABELS[currentPlan] ?? currentPlan}
                    </span>
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", statusMeta.color)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", statusMeta.dot)} aria-hidden />
                      {statusMeta.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[13.5px] text-slate-500">
                    {PLAN_TAGLINES[currentPlan] ?? "Your current plan."}
                  </p>
                </div>
              </div>

              {isPro && (
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                  Manage billing
                </button>
              )}
            </div>

            <dl className="mt-6 grid gap-4 border-t border-slate-100 pt-5 sm:grid-cols-3">
              <Stat
                icon={CreditCard}
                label="Price"
                value={isPro ? `${amountLabel}${resolvedInterval === "yearly" ? "/yr" : "/mo"}` : "Free"}
                hint={isPro ? (resolvedInterval === "yearly" ? "Yearly billing" : "Monthly billing") : "No card on file"}
              />
              <Stat
                icon={CalendarDays}
                label={renewLabel}
                value={periodEnd ?? "—"}
                hint={periodEnd ? (resolvedCancelAtPeriodEnd ? "Plan ends after this date" : "Auto-renews") : "Free plan never expires"}
              />
              <Stat
                icon={Receipt}
                label="Billing cycle"
                value={resolvedInterval === "yearly" ? "Yearly" : "Monthly"}
                hint={isPro && resolvedInterval !== "yearly" ? "Switch to yearly to save 35%" : "—"}
              />
            </dl>
          </div>
        </section>

        {/* ── Usage ── */}
        {isPro && usage && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <TrendingUp className="h-4 w-4 text-slate-500" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">This billing period</h2>
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-2">
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
          </section>
        )}

        {/* ── Billing interval switch ── */}
        {isPro && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
                  <Receipt className="h-5 w-5 text-emerald-600" aria-hidden />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Billing options</p>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {resolvedInterval === "yearly"
                      ? "You're on yearly billing — saving 35% vs monthly."
                      : "Switch to yearly billing and save 35%."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  startCheckout(
                    currentPlan === "pro_international" ? "pro_international" : "pro",
                    resolvedInterval === "yearly" ? "monthly" : "yearly"
                  )
                }
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                {resolvedInterval === "yearly" ? "Switch to monthly" : "Save 35% with yearly"}
              </button>
            </div>
          </section>
        )}

        {/* ── Cancellation banner ── */}
        {(resolvedCancelAtPeriodEnd || status === "canceled" || returnedFromPortal) && isPro && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-rose-200/80 bg-rose-50/40 shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="p-6">
              <p className="text-sm font-semibold text-rose-800">Before you go</p>
              <p className="mt-1 text-sm text-rose-700/80">
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
                <div className="mt-5 border-t border-rose-100 pt-5">
                  <p className="text-sm font-semibold text-slate-900">Help us improve — why are you canceling?</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {["Too expensive", "Not finding jobs", "Missing a feature", "Found another tool", "Other"].map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        onClick={() => setFeedbackReason(reason)}
                        className={cn(
                          "rounded-xl border px-3 py-2 text-left text-sm transition",
                          feedbackReason === reason
                            ? "border-[#FF5C18] bg-[#FFF1E8] text-[#9A3412]"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                        )}
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
          </section>
        )}

        {/* ── Upgrade CTAs ── */}
        {currentPlan === "free" && (
          <UpgradeCard
            tone="sky"
            kicker="Recommended"
            title="Upgrade to Pro"
            description="Unlock AI resume tools, autofill, deep analyses, and unlimited alerts."
            ctaLabel="Start Pro trial"
            onClick={() => startCheckout("pro")}
          />
        )}

        {currentPlan === "pro" && (
          <UpgradeCard
            tone="orange"
            kicker="For international job seekers"
            title="Upgrade to Pro International"
            description="Unlimited cover letters, H1B sponsorship intel, and OPT urgency routing."
            ctaLabel="Upgrade"
            onClick={() => startCheckout("pro_international", resolvedInterval)}
          />
        )}

        {/* ── Compare plans ── */}
        <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
          <button
            type="button"
            onClick={() => setCompareOpen(!compareOpen)}
            aria-expanded={compareOpen}
            className="flex w-full items-center justify-between px-6 py-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />
              Compare plans
            </span>
            <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform duration-200", compareOpen && "rotate-180")} />
          </button>
          {compareOpen && (
            <div className="overflow-x-auto border-t border-slate-100">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60">
                    <th className="w-1/2 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">Feature</th>
                    <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">Free</th>
                    <th className="bg-sky-50/40 px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-sky-700">Pro</th>
                    <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-orange-600">Pro Intl.</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, i) => (
                    <FeatureRow key={i} {...row} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-2 text-center text-xs text-slate-400">
          Questions?{" "}
          <a href="mailto:support@hireoven.com" className="font-medium text-slate-600 hover:text-slate-900 hover:underline">
            support@hireoven.com
          </a>
        </p>
      </div>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CalendarDays
  label: string
  value: string
  hint?: string
}) {
  return (
    <div>
      <dt className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
        {label}
      </dt>
      <dd className="mt-1 text-[15px] font-semibold text-slate-900">{value}</dd>
      {hint && <p className="mt-0.5 text-[12px] text-slate-400">{hint}</p>}
    </div>
  )
}

function UpgradeCard({
  tone,
  kicker,
  title,
  description,
  ctaLabel,
  onClick,
}: {
  tone: "sky" | "orange"
  kicker: string
  title: string
  description: string
  ctaLabel: string
  onClick: () => void
}) {
  const palette =
    tone === "sky"
      ? {
          gradient: "from-sky-500 via-indigo-500 to-violet-500",
          tint: "bg-sky-50",
          ring: "ring-sky-100",
          icon: "text-sky-600",
          button: "bg-[#0369A1] hover:bg-[#075985] shadow-[0_4px_14px_rgba(3,105,161,0.25)]",
          kicker: "text-sky-700",
        }
      : {
          gradient: "from-orange-500 via-rose-500 to-pink-500",
          tint: "bg-orange-50",
          ring: "ring-orange-100",
          icon: "text-orange-600",
          button: "bg-[#ea580c] hover:bg-[#c2410c] shadow-[0_4px_14px_rgba(234,88,12,0.25)]",
          kicker: "text-orange-700",
        }
  const Icon = tone === "sky" ? Sparkles : Globe2

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
      <div className={cn("h-1 w-full bg-gradient-to-r", palette.gradient)} />
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1", palette.tint, palette.ring)}>
            <Icon className={cn("h-5 w-5", palette.icon)} aria-hidden />
          </div>
          <div>
            <p className={cn("text-[11px] font-semibold uppercase tracking-widest", palette.kicker)}>{kicker}</p>
            <p className="mt-0.5 text-[16px] font-bold text-slate-900">{title}</p>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition",
            palette.button
          )}
        >
          {ctaLabel}
        </button>
      </div>
    </section>
  )
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 100
  const isUnlimited = limit === null
  const isNearLimit = !isUnlimited && pct >= 80
  const isAtLimit = !isUnlimited && pct >= 100

  const barColor = isUnlimited
    ? "bg-emerald-500"
    : isAtLimit
      ? "bg-rose-500"
      : isNearLimit
        ? "bg-amber-500"
        : "bg-[#0369A1]"

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300">
      <div className="flex items-baseline justify-between">
        <p className="text-[12px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
        {isUnlimited ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Unlimited</span>
        ) : (
          <span className={cn(
            "text-[11px] font-semibold tabular-nums",
            isAtLimit ? "text-rose-600" : isNearLimit ? "text-amber-600" : "text-slate-500"
          )}>
            {pct}%
          </span>
        )}
      </div>
      <p className="mt-1 text-[20px] font-bold tabular-nums text-slate-900">
        {used.toLocaleString()}
        {!isUnlimited && (
          <span className="text-[14px] font-medium text-slate-400"> / {limit?.toLocaleString()}</span>
        )}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${isUnlimited ? 100 : pct}%` }}
        />
      </div>
    </div>
  )
}
