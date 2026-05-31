"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Globe2,
  GraduationCap,
  Headphones,
  Loader2,
  Plus,
  Receipt,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react"
import { useSubscription } from "@/lib/hooks/useSubscription"
import FeatureRow from "@/components/pricing/FeatureRow"
import { cn } from "@/lib/utils"
import { getPlanAmountCents, PLAN_COMPARISON_ROWS, type BillingInterval, type PlanKey } from "@/lib/pricing"
import {
  FEATURE_QUOTAS,
  METERED_FEATURE_KEYS,
  type MeteredFeature,
  type QuotaConfig,
  type QuotaState,
} from "@/lib/usage/quotas"
import { FEATURE_PACKS, type PackKey } from "@/lib/billing/packs"

export interface UsageData {
  plan: string
  quotas: Record<MeteredFeature, QuotaState>
  config: Record<MeteredFeature, QuotaConfig>
  packBalances: Record<MeteredFeature, number>
  interviewCredits: {
    balance: number
    pendingProMaxGrant: number
  }
}

export interface BillingInfo {
  plan: string
  status: string
  currentPeriodEnd: string | null
  billingInterval: BillingInterval | null
  amountCents: number | null
  cancelAtPeriodEnd: boolean
}

export interface BillingHistoryItem {
  id: string
  createdAt: string | null
  description: string
  amountCents: number
  currency: string
  status: string
  hostedInvoiceUrl: string | null
  invoicePdfUrl: string | null
}

export interface BillingHistoryData {
  history: BillingHistoryItem[]
  summary: {
    nextRenewalAt: string | null
    nextAmountCents: number | null
    currency: string | null
  }
}

function normalizeUiPlan(plan: string | null | undefined): PlanKey | "free" {
  if (plan === "pro_international") return "pro_max"
  if (plan === "pro" || plan === "pro_max") return plan
  return "free"
}

function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function invoiceStatusTone(status: string): string {
  if (status === "paid") return "bg-emerald-50 text-emerald-700"
  if (status === "open" || status === "draft") return "bg-amber-50 text-amber-700"
  if (status === "void" || status === "uncollectible") return "bg-rose-50 text-rose-700"
  return "bg-slate-100 text-slate-600"
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  pro_international: "Pro Max",
  pro_max: "Pro Max",
}

const PLAN_TAGLINES: Record<string, string> = {
  free: "Browse the live job feed and track applications.",
  pro: "AI tools, unlimited alerts, autofill, and deep analyses.",
  pro_international: "Everything in Pro plus Apex strategy and unlimited AI tools.",
  pro_max: "Everything in Pro plus Apex strategy and unlimited AI tools.",
}

const STATUS_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  free:      { label: "Active",   color: "bg-slate-100 text-slate-600",       dot: "bg-slate-400" },
  active:    { label: "Active",   color: "bg-emerald-50 text-emerald-700",    dot: "bg-emerald-500" },
  trialing:  { label: "Trial",    color: "bg-amber-50 text-amber-700",        dot: "bg-amber-500" },
  canceled:  { label: "Canceled", color: "bg-rose-50 text-rose-700",          dot: "bg-rose-500" },
  past_due:  { label: "Past due", color: "bg-rose-50 text-rose-700",          dot: "bg-rose-500" },
  unpaid:    { label: "Unpaid",   color: "bg-rose-50 text-rose-700",          dot: "bg-rose-500" },
}

function planAccent(plan: string) {
  if (plan === "pro_max" || plan === "pro_international") {
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

type BillingPageClientProps = {
  initialBilling?: BillingInfo | null
  initialBillingLoaded?: boolean
  initialUsage?: UsageData | null
  initialUsageLoaded?: boolean
  initialHistory?: BillingHistoryData | null
  initialHistoryLoaded?: boolean
  returnedFromPortal?: boolean
}

export default function BillingPageClient({
  initialBilling = null,
  initialBillingLoaded = false,
  initialUsage = null,
  initialUsageLoaded = false,
  initialHistory = null,
  initialHistoryLoaded = false,
  returnedFromPortal = false,
}: BillingPageClientProps) {
  const {
    plan,
    status: subscriptionStatus,
    currentPeriodEnd,
    billingInterval,
    amountCents,
    cancelAtPeriodEnd,
    isLoading: subLoading,
  } = useSubscription()
  const [billing, setBilling] = useState<BillingInfo | null>(initialBilling)
  const [usage, setUsage] = useState<UsageData | null>(initialUsage)
  const [billingLoaded, setBillingLoaded] = useState(initialBillingLoaded)
  const [usageLoaded, setUsageLoaded] = useState(initialUsageLoaded)
  const [historyData, setHistoryData] = useState<BillingHistoryData | null>(initialHistory)
  const [historyLoaded, setHistoryLoaded] = useState(initialHistoryLoaded)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [feedbackReason, setFeedbackReason] = useState("")
  const [feedbackDetails, setFeedbackDetails] = useState("")
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)
  const [promoInput, setPromoInput] = useState("")
  const [promoCode, setPromoCode] = useState<string | null>(null)
  const [promoLabel, setPromoLabel] = useState<string | null>(null)
  const [promoError, setPromoError] = useState<string | null>(null)
  const [promoChecking, setPromoChecking] = useState(false)
  const [studentStatus, setStudentStatus] = useState<{ isStudent: boolean; email: string | null } | null>(null)
  const [studentEmailInput, setStudentEmailInput] = useState("")
  const [studentCodeInput, setStudentCodeInput] = useState("")
  const [studentStep, setStudentStep] = useState<"email" | "code" | "verified">("email")
  const [studentError, setStudentError] = useState<string | null>(null)
  const [studentBusy, setStudentBusy] = useState(false)
  const [creditsModalOpen, setCreditsModalOpen] = useState(false)
  const [creditsBusy, setCreditsBusy] = useState<string | null>(null)
  const [creditsError, setCreditsError] = useState<string | null>(null)
  const currentPlanForHistory = normalizeUiPlan(billing?.plan ?? plan ?? "free")
  const shouldLoadHistory = currentPlanForHistory === "pro" || currentPlanForHistory === "pro_max"

  useEffect(() => {
    if (!billingLoaded) {
      fetch("/api/subscription")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return
          setBilling(data)
        })
        .catch(() => {})
        .finally(() => setBillingLoaded(true))
    }

    if (!usageLoaded) {
      fetch("/api/billing/usage")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => data && setUsage(data))
        .catch(() => {})
        .finally(() => setUsageLoaded(true))
    }
  }, [billingLoaded, usageLoaded])

  useEffect(() => {
    if (historyLoaded || !shouldLoadHistory) return
    fetch("/api/billing/history")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        setHistoryData(data as BillingHistoryData)
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true))
  }, [historyLoaded, shouldLoadHistory])

  useEffect(() => {
    fetch("/api/student/verify")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { isStudent?: boolean; email?: string | null } | null) => {
        if (!data) return
        const next = { isStudent: Boolean(data.isStudent), email: data.email ?? null }
        setStudentStatus(next)
        if (next.isStudent) setStudentStep("verified")
      })
      .catch(() => {})
  }, [])

  async function openPortal() {
    setPortalLoading(true)
    setPortalError(null)
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (data.url) {
        window.location.href = data.url
        return
      }
      // 404 = stale subscription row with no Stripe customer; 503 = Stripe not
      // configured; etc. Surface the message so the user isn't stuck on a dead
      // spinner.
      setPortalError(
        res.status === 404
          ? "We don't have a Stripe billing account on file for you yet. Start a Pro trial below."
          : data.error ?? "Couldn't open the billing portal. Try again in a moment."
      )
    } catch {
      setPortalError("Couldn't reach the server. Try again.")
    } finally {
      setPortalLoading(false)
    }
  }

  async function startCheckout(targetPlan: PlanKey, targetInterval: BillingInterval = "monthly") {
    setPromoError(null)
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: targetPlan,
          interval: targetInterval,
          ...(promoCode ? { promoCode } : {}),
        }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (data?.url) {
        window.location.href = data.url
        return
      }
      setPromoError(
        data?.error
          ?? (res.status >= 500
            ? "Stripe is having issues — try again in a moment."
            : "Couldn't start checkout. Try again.")
      )
    } catch {
      setPromoError("Couldn't reach the server. Try again.")
    }
  }

  async function validatePromo() {
    const raw = promoInput.trim()
    if (!raw) {
      setPromoError("Enter a code.")
      return
    }
    setPromoChecking(true)
    setPromoError(null)
    try {
      const res = await fetch("/api/stripe/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: raw }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPromoCode(null)
        setPromoLabel(null)
        setPromoError(data.error ?? "Couldn't validate that code.")
        return
      }
      setPromoCode(data.code)
      setPromoLabel(data.label)
      setPromoError(null)
    } catch {
      setPromoError("Couldn't reach the server. Try again.")
    } finally {
      setPromoChecking(false)
    }
  }

  function clearPromo() {
    setPromoInput("")
    setPromoCode(null)
    setPromoLabel(null)
    setPromoError(null)
  }

  async function sendStudentCode() {
    const email = studentEmailInput.trim().toLowerCase()
    if (!email) {
      setStudentError("Enter your school email.")
      return
    }
    setStudentBusy(true)
    setStudentError(null)
    try {
      const res = await fetch("/api/student/verify/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStudentError(data.error ?? "Couldn't send the code.")
        return
      }
      setStudentStep("code")
      setStudentError(null)
    } catch {
      setStudentError("Couldn't reach the server. Try again.")
    } finally {
      setStudentBusy(false)
    }
  }

  async function confirmStudentCode() {
    const code = studentCodeInput.trim()
    if (!code) {
      setStudentError("Enter the code from your email.")
      return
    }
    setStudentBusy(true)
    setStudentError(null)
    try {
      const res = await fetch("/api/student/verify/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStudentError(data.error ?? "Couldn't verify that code.")
        return
      }
      setStudentStatus({ isStudent: true, email: data.email ?? studentEmailInput.trim().toLowerCase() })
      setStudentStep("verified")
      setStudentCodeInput("")
      setStudentError(null)
    } catch {
      setStudentError("Couldn't reach the server. Try again.")
    } finally {
      setStudentBusy(false)
    }
  }

  function restartStudentFlow() {
    setStudentStep("email")
    setStudentCodeInput("")
    setStudentError(null)
  }

  async function buyInterviewCredits(packKey: InterviewCreditPackKey) {
    setCreditsBusy(packKey)
    setCreditsError(null)
    try {
      const res = await fetch("/api/interview/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: packKey }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (data?.url) {
        window.location.href = data.url
        return
      }
      setCreditsError(
        data?.error
          ?? (res.status >= 500
            ? "Stripe is having issues — try again in a moment."
            : "Couldn't start checkout. Try again.")
      )
    } catch {
      setCreditsError("Couldn't reach the server. Try again.")
    } finally {
      setCreditsBusy(null)
    }
  }

  async function buyPack(packKey: PackKey) {
    try {
      const res = await fetch("/api/billing/packs/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: packKey, returnUrl: "/dashboard/billing" }),
      })
      const data = await res.json().catch(() => null) as { url?: string; error?: string } | null
      if (data?.url) window.location.href = data.url
    } catch (err) {
      console.warn("[billing] pack checkout failed:", err)
    }
  }

  async function submitCancellationFeedback() {
    await fetch("/api/subscription/cancel-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: feedbackReason, details: feedbackDetails }),
    })
    setFeedbackSubmitted(true)
  }

  if (subLoading && !billingLoaded) {
    return (
      <div className="app-page flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  const currentPlan = normalizeUiPlan(billing?.plan ?? plan ?? "free")
  const status = billing?.status ?? subscriptionStatus ?? "free"
  const resolvedInterval = billing?.billingInterval ?? billingInterval ?? "monthly"
  const resolvedAmountCents = billing?.amountCents ?? amountCents
  const resolvedCancelAtPeriodEnd = billing?.cancelAtPeriodEnd ?? cancelAtPeriodEnd
  const isPro = currentPlan === "pro" || currentPlan === "pro_max"
  const historySummary = historyData?.summary
  const historyEntries = historyData?.history ?? []
  const effectiveAmountCents =
    typeof resolvedAmountCents === "number" && resolvedAmountCents > 0
      ? resolvedAmountCents
      : typeof historySummary?.nextAmountCents === "number" && historySummary.nextAmountCents > 0
        ? historySummary.nextAmountCents
        : isPro
          ? getPlanAmountCents(currentPlan as PlanKey, resolvedInterval)
          : 0
  const periodEndSource = billing?.currentPeriodEnd ?? currentPeriodEnd ?? historySummary?.nextRenewalAt ?? null
  const periodEnd = periodEndSource
    ? new Date(periodEndSource).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null
  const fallbackRenewValue = resolvedInterval === "yearly" ? "Every year" : "Every month"
  const renewValue = periodEnd ?? (isPro ? fallbackRenewValue : "Never")
  const renewHint = periodEnd
    ? (resolvedCancelAtPeriodEnd ? "Plan ends after this date" : "Auto-renews")
    : isPro
      ? "Next renewal date syncs after Stripe confirms cycle."
      : "Free plan never expires"

  const statusMeta = STATUS_LABELS[status] ?? STATUS_LABELS["free"]
  const accent = planAccent(currentPlan)
  const PlanIcon = accent.icon
  const effectiveCurrency = historySummary?.currency ?? "USD"
  const amountLabel = isPro ? formatMoney(effectiveAmountCents, effectiveCurrency) : "$0"
  const renewLabel =
    status === "trialing"
      ? "Trial ends"
      : status === "canceled" || resolvedCancelAtPeriodEnd
        ? "Access until"
        : "Renews"

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

        {/* ── Student verification (lifted above plan card so it's the first
              call-to-action for free / pro users arriving from a discount banner) ── */}
        {currentPlan !== "pro_max" && (
          <section
            id="student-verify"
            className="mb-5 overflow-hidden rounded-2xl border-2 border-indigo-200 bg-indigo-50/40 shadow-[0_2px_12px_rgba(15,23,42,0.04)]"
          >
            <div className="flex items-center gap-2 border-b border-indigo-100 px-6 py-4">
              <GraduationCap className="h-4 w-4 text-indigo-500" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Student discount — 30% off Pro</h2>
            </div>
            <div className="p-6">
              {studentStep === "verified" && studentStatus?.isStudent ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-indigo-700">
                      Student status verified
                    </p>
                    <p className="mt-0.5 text-[13px] text-slate-500">
                      {studentStatus.email ? `Verified for ${studentStatus.email}. ` : ""}
                      30% off Pro is locked in. Click below to finish at Stripe.
                    </p>
                  </div>
                  {currentPlan === "free" && (
                    <button
                      type="button"
                      onClick={() => startCheckout("pro")}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                    >
                      Continue to checkout
                      <ChevronDown className="h-4 w-4 -rotate-90" aria-hidden />
                    </button>
                  )}
                  {currentPlan === "pro" && (
                    <button
                      type="button"
                      onClick={() => startCheckout("pro_max", resolvedInterval)}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700"
                    >
                      Upgrade to Pro Max
                      <ChevronDown className="h-4 w-4 -rotate-90" aria-hidden />
                    </button>
                  )}
                </div>
              ) : studentStep === "email" ? (
                <div>
                  <p className="mb-3 text-[13px] text-slate-700">
                    Use your school&apos;s <span className="font-mono">.edu</span> email. We&apos;ll send a 6-digit code to confirm it&apos;s yours.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <input
                      type="email"
                      value={studentEmailInput}
                      onChange={(event) => {
                        setStudentEmailInput(event.target.value)
                        if (studentError) setStudentError(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          void sendStudentCode()
                        }
                      }}
                      placeholder="you@school.edu"
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => void sendStudentCode()}
                      disabled={studentBusy || !studentEmailInput.trim()}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {studentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send code"}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="mb-3 text-[13px] text-slate-700">
                    We sent a code to <span className="font-mono">{studentEmailInput || "your school email"}</span>. It expires in 15 minutes.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={studentCodeInput}
                      onChange={(event) => {
                        setStudentCodeInput(event.target.value.replace(/\D/g, ""))
                        if (studentError) setStudentError(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault()
                          void confirmStudentCode()
                        }
                      }}
                      placeholder="123456"
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-lg tracking-[0.4em] text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                    />
                    <button
                      type="button"
                      onClick={() => void confirmStudentCode()}
                      disabled={studentBusy || studentCodeInput.length !== 6}
                      className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {studentBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                    </button>
                  </div>
                  <div className="mt-2 flex gap-3 text-[12px]">
                    <button
                      type="button"
                      onClick={restartStudentFlow}
                      className="text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline"
                    >
                      Use a different email
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendStudentCode()}
                      disabled={studentBusy}
                      className="text-slate-500 underline-offset-4 hover:text-slate-700 hover:underline disabled:opacity-50"
                    >
                      Resend code
                    </button>
                  </div>
                </div>
              )}
              {studentError && (
                <p className="mt-2 text-[12.5px] font-medium text-rose-600">{studentError}</p>
              )}
            </div>
          </section>
        )}

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
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <button
                    type="button"
                    onClick={openPortal}
                    disabled={portalLoading}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {portalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    Manage billing
                  </button>
                  {portalError && (
                    <p className="max-w-[260px] text-right text-[11.5px] font-medium text-rose-600">
                      {portalError}
                    </p>
                  )}
                </div>
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
                value={renewValue}
                hint={renewHint}
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

        {/* ── Usage meters ── */}
        {usage && usage.quotas && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <TrendingUp className="h-4 w-4 text-slate-500" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">This month&apos;s usage</h2>
            </div>
            <div className="grid gap-3 p-6 sm:grid-cols-2">
              {METERED_FEATURE_KEYS.map((feature) => {
                const config = FEATURE_QUOTAS[feature]
                const quota = usage.quotas[feature]
                return (
                  <UsageMeter
                    key={feature}
                    label={config.label}
                    period={config.period}
                    used={quota?.used ?? 0}
                    limit={quota?.limit ?? 0}
                    packRemaining={usage.packBalances?.[feature] ?? 0}
                  />
                )
              })}
            </div>
          </section>
        )}

        {/* ── Interview credits ── */}
        {usage && usage.interviewCredits && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <Headphones className="h-4 w-4 text-slate-500" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Live interview credits</h2>
            </div>
            <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[28px] font-bold tabular-nums text-slate-900">
                  {(usage.interviewCredits.balance ?? 0).toLocaleString()}
                  <span className="ml-1 text-sm font-medium text-slate-500">
                    {usage.interviewCredits.balance === 1 ? "credit" : "credits"}
                  </span>
                </p>
                <p className="mt-1 text-[13px] text-slate-500">
                  1 credit = 1 live voice + webcam interview session.
                  {currentPlan === "pro_max" && " You get 1 free credit every 28 days."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setCreditsError(null)
                  setCreditsModalOpen(true)
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Buy interview credits
              </button>
            </div>
          </section>
        )}

        {/* ── Top-up packs ── */}
        {usage && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <Zap className="h-4 w-4 text-amber-500" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Top-up packs</h2>
            </div>
            <div className="px-6 py-4">
              <p className="text-[13px] text-slate-500">
                Hitting your monthly cap? Buy extra credits à la carte. Packs never expire and stack on top of your plan&apos;s monthly allowance.
              </p>
            </div>
            <div className="grid gap-2 px-6 pb-6 sm:grid-cols-2">
              {(Object.entries(FEATURE_PACKS) as [PackKey, typeof FEATURE_PACKS[PackKey]][]).map(
                ([packKey, pack]) => (
                  <PackCard
                    key={packKey}
                    packKey={packKey}
                    label={pack.label}
                    description={pack.description}
                    amountCents={pack.amountCents}
                    onBuy={buyPack}
                  />
                )
              )}
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
                    currentPlan === "pro_max" ? "pro_max" : "pro",
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

        {/* ── Billing history ── */}
        {isPro && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <Receipt className="h-4 w-4 text-slate-500" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Billing history</h2>
            </div>

            {!historyLoaded ? (
              <div className="flex items-center gap-2 px-6 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                Loading invoice history…
              </div>
            ) : historyEntries.length === 0 ? (
              <div className="px-6 py-6 text-sm text-slate-500">
                No invoices yet. Charges will appear here once Stripe finalizes your first billing cycle.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">Date</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">Description</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">Amount</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-slate-500">Status</th>
                      <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-slate-500">Receipt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyEntries.map((entry) => {
                      const statusTone = invoiceStatusTone(entry.status)
                      return (
                        <tr key={entry.id} className="border-b border-slate-100 last:border-b-0">
                          <td className="px-6 py-3 text-sm text-slate-700">
                            {entry.createdAt
                              ? new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">{entry.description}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-slate-900">
                            {formatMoney(entry.amountCents, entry.currency || "USD")}
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone)}>
                              {entry.status.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td className="px-6 py-3 text-right">
                            {(entry.invoicePdfUrl || entry.hostedInvoiceUrl) ? (
                              <a
                                href={entry.invoicePdfUrl ?? entry.hostedInvoiceUrl ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm font-medium text-slate-700 underline-offset-4 hover:text-slate-900 hover:underline"
                              >
                                View
                              </a>
                            ) : (
                              <span className="text-sm text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
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

        {/* ── Promo code ── */}
        {!isPro && (
          <section className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.04)]">
            <div className="flex items-center gap-2 border-b border-slate-100 px-6 py-4">
              <Sparkles className="h-4 w-4 text-emerald-500" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-900">Have a promo code?</h2>
            </div>
            <div className="p-6">
              {promoCode && promoLabel ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-emerald-700">
                      Code <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono">{promoCode}</span> applied
                    </p>
                    <p className="mt-0.5 text-[13px] text-slate-500">{promoLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={clearPromo}
                    className="self-start rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 sm:self-auto"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                  <input
                    type="text"
                    value={promoInput}
                    onChange={(event) => {
                      setPromoInput(event.target.value)
                      if (promoError) setPromoError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault()
                        void validatePromo()
                      }
                    }}
                    placeholder="LAUNCH50"
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 font-mono text-sm uppercase tracking-wider text-slate-800 outline-none transition focus:border-[#FF5C18] focus:ring-2 focus:ring-[#FFD2B8]"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => void validatePromo()}
                    disabled={promoChecking || !promoInput.trim()}
                    className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {promoChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                  </button>
                </div>
              )}
              {promoError && (
                <p className="mt-2 text-[12.5px] font-medium text-rose-600">{promoError}</p>
              )}
              {!promoCode && (
                <p className="mt-2 text-[11.5px] text-slate-400">
                  Codes apply at checkout and stack on top of trial/yearly discounts where Stripe allows it.
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
            description={
              promoCode
                ? `Promo ${promoCode} will be applied at checkout. ${promoLabel ?? ""}`
                : studentStatus?.isStudent
                  ? "Student discount (30% off) will be applied automatically at checkout."
                  : "Unlock AI resume tools, autofill, deep analyses, and unlimited alerts."
            }
            ctaLabel="Start Pro trial"
            onClick={() => startCheckout("pro")}
          />
        )}

        {currentPlan === "pro" && (
          <UpgradeCard
            tone="orange"
            kicker="For advanced preparation"
            title="Upgrade to Pro Max"
            description={
              promoCode
                ? `Promo ${promoCode} will be applied at checkout. ${promoLabel ?? ""}`
                : studentStatus?.isStudent
                  ? "Student discount (30% off) will be applied automatically at checkout."
                  : "Live voice interviews, Apex strategy, and unlimited AI usage."
            }
            ctaLabel="Upgrade"
            onClick={() => startCheckout("pro_max", resolvedInterval)}
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
                    <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-orange-600">Pro Max</th>
                  </tr>
                </thead>
                <tbody>
                  {PLAN_COMPARISON_ROWS.map((row, i) => (
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

      {creditsModalOpen && (
        <InterviewCreditsModal
          busyPackKey={creditsBusy}
          error={creditsError}
          onClose={() => setCreditsModalOpen(false)}
          onBuy={buyInterviewCredits}
        />
      )}
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

function formatPackAmount(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function PackCard({
  packKey,
  label,
  description,
  amountCents,
  onBuy,
}: {
  packKey: PackKey
  label: string
  description: string
  amountCents: number
  onBuy: (key: PackKey) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-slate-300">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-slate-900">{label}</p>
        <p className="mt-0.5 text-[12px] text-slate-500">{description}</p>
      </div>
      <button
        type="button"
        onClick={() => onBuy(packKey)}
        className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-slate-800"
      >
        {formatPackAmount(amountCents)}
      </button>
    </div>
  )
}

function UsageMeter({
  label,
  period,
  used,
  limit,
  packRemaining = 0,
}: {
  label: string
  period: "day" | "month"
  used: number
  limit: number
  packRemaining?: number
}) {
  const isZero = limit === 0 && packRemaining === 0
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const isNearLimit = limit > 0 && pct >= 80
  const isAtLimit = limit > 0 && pct >= 100
  const periodWord = period === "day" ? "Today" : "This month"

  const barColor = isAtLimit
    ? packRemaining > 0
      ? "bg-amber-500"
      : "bg-rose-500"
    : isNearLimit
      ? "bg-amber-500"
      : "bg-[#0369A1]"

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-widest text-slate-500">{label}</p>
        <span className="text-[11px] text-slate-400">{periodWord}</span>
      </div>
      <p className="mt-1 text-[20px] font-bold tabular-nums text-slate-900">
        {used.toLocaleString()}
        <span className="text-[14px] font-medium text-slate-400"> / {limit.toLocaleString()}</span>
        {packRemaining > 0 && (
          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">
            <Zap className="h-2.5 w-2.5" aria-hidden /> +{packRemaining} pack
          </span>
        )}
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn("h-full rounded-full transition-all", isZero ? "bg-slate-300" : barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {isAtLimit && (
        <p className="mt-2 text-[11.5px] font-medium text-rose-600">
          {packRemaining > 0
            ? `Cap reached — next call uses 1 pack credit (${packRemaining} left).`
            : "Cap reached — buy a top-up pack below to keep going."}
        </p>
      )}
    </div>
  )
}

// ── Live interview credit packs ────────────────────────────────────────────
// Mirrors app/api/interview/credits/checkout/route.ts. Keep in sync; server
// validates against its own copy so a stale client can't fake a pack price.
type InterviewCreditPackKey =
  | "session_short_1"
  | "session_long_1"
  | "session_short_3"
  | "session_short_5"

const INTERVIEW_CREDIT_PACKS: Record<
  InterviewCreditPackKey,
  { credits: number; amountCents: number; label: string; subtitle: string; recommended?: boolean }
> = {
  session_short_1: {
    credits: 1,
    amountCents: 1200,
    label: "1 session",
    subtitle: "Up to 30 min",
  },
  session_long_1: {
    credits: 1,
    amountCents: 2000,
    label: "1 long session",
    subtitle: "Up to 60 min",
  },
  session_short_3: {
    credits: 3,
    amountCents: 3000,
    label: "3 sessions",
    subtitle: "Up to 30 min each",
    recommended: true,
  },
  session_short_5: {
    credits: 5,
    amountCents: 4500,
    label: "5 sessions",
    subtitle: "Up to 30 min each",
  },
}

function InterviewCreditsModal({
  busyPackKey,
  error,
  onClose,
  onBuy,
}: {
  busyPackKey: string | null
  error: string | null
  onClose: () => void
  onBuy: (key: InterviewCreditPackKey) => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Buy live interview credits"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 backdrop-blur-[2px] sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">Buy live interview credits</h3>
            <p className="mt-0.5 text-[13px] text-slate-500">
              1 credit = 1 live voice + webcam session. Credits never expire.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-full p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 3l10 10M13 3l-10 10" />
            </svg>
          </button>
        </div>

        <div className="grid gap-2 p-6">
          {(Object.entries(INTERVIEW_CREDIT_PACKS) as [InterviewCreditPackKey, typeof INTERVIEW_CREDIT_PACKS[InterviewCreditPackKey]][]).map(
            ([key, pack]) => {
              const busy = busyPackKey === key
              const perCredit = pack.amountCents / pack.credits
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onBuy(key)}
                  disabled={busyPackKey !== null}
                  className={cn(
                    "relative flex items-center justify-between gap-3 rounded-xl border bg-white p-4 text-left transition disabled:opacity-60",
                    pack.recommended
                      ? "border-orange-200 bg-orange-50/40 hover:border-orange-300"
                      : "border-slate-200 hover:border-slate-300"
                  )}
                >
                  {pack.recommended && (
                    <span className="absolute -top-2 left-4 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                      Best value
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{pack.label}</p>
                    <p className="mt-0.5 text-[12px] text-slate-500">{pack.subtitle}</p>
                    {pack.credits > 1 && (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        ${(perCredit / 100).toFixed(2)} / credit
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[18px] font-bold tabular-nums text-slate-900">
                      ${(pack.amountCents / 100).toFixed(0)}
                    </span>
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
                  </div>
                </button>
              )
            }
          )}
        </div>

        {error && (
          <p className="px-6 pb-4 text-[12.5px] font-medium text-rose-600">{error}</p>
        )}

        <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-3 text-[11.5px] text-slate-500">
          Payment processed by Stripe. You'll be redirected to complete checkout.
        </div>
      </div>
    </div>
  )
}
