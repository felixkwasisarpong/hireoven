"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Code2, CreditCard, Lock, MessageSquare, Video } from "lucide-react"
import { useSubscription } from "@/lib/context/SubscriptionContext"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"

type CreditInfo = {
  balance: number
  costs: { short: number; long: number }
} | null

// ── Credit buy button ─────────────────────────────────────────────────────────

function BuyCreditsButton({ pack, label, highlight = false }: {
  pack: string
  label: string
  highlight?: boolean
}) {
  const [loading, setLoading] = useState(false)

  async function buy() {
    setLoading(true)
    try {
      const res = await fetch("/api/interview/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={buy}
      disabled={loading}
      className={cn(
        "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition disabled:opacity-60",
        highlight
          ? "bg-orange-500 text-white hover:bg-orange-600"
          : "border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100"
      )}
    >
      <CreditCard className="h-3.5 w-3.5" />
      {loading ? "Redirecting…" : label}
    </button>
  )
}

// ── Locked card overlay ───────────────────────────────────────────────────────

function LockedCard({
  icon: Icon,
  label,
  tagline,
  description,
  requiredPlan,
}: {
  icon: React.ElementType
  label: string
  tagline: string
  description: string
  requiredPlan: "pro" | "pro_max"
}) {
  const badge = requiredPlan === "pro_max" ? "Pro Max" : "Pro"
  const badgeCls = requiredPlan === "pro_max"
    ? "bg-blue-600 text-white"
    : "bg-orange-500 text-white"

  return (
    <div className="group relative flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm opacity-80">
      {/* Lock overlay */}
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-white/85 backdrop-blur-[2px]">
        <Lock className="mb-2 h-6 w-6 text-slate-400" />
        <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide", badgeCls)}>
          {badge}
        </span>
        <p className="mt-1.5 text-center text-[12px] text-slate-500">
          {requiredPlan === "pro_max"
            ? "Upgrade to Pro Max to unlock live interviews."
            : "Upgrade to Pro to unlock text & coding interviews."}
        </p>
        <Link
          href="/dashboard/upgrade"
          className="mt-3 rounded-lg bg-slate-900 px-4 py-1.5 text-[12px] font-semibold text-white transition hover:bg-slate-700"
        >
          Upgrade
        </Link>
      </div>

      {/* Blurred content behind */}
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-500">{tagline}</p>
      <h3 className="mt-1 text-[15px] font-semibold text-slate-900">{label}</h3>
      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-slate-500">{description}</p>
      <div className="mt-4 h-9 rounded-lg bg-slate-100" />
    </div>
  )
}

// ── Live card (Pro Max + credits) ─────────────────────────────────────────────

function LiveCard({ credits }: { credits: CreditInfo }) {
  const balance = credits?.balance ?? 0
  const hasSessions = balance >= 1

  return (
    <div className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
        <Video className="h-5 w-5" strokeWidth={2} />
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-500">
        Voice + webcam. Real pressure.
      </p>
      <h3 className="mt-1 text-[15px] font-semibold text-slate-900">Live Interview</h3>
      <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-slate-500">
        Best for final-round prep. Speak your answers, hold eye contact, get real-time interviewer energy.
      </p>

      {/* Sessions indicator */}
      <div className="mt-3 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
        <span className="text-[12px] text-slate-500">Sessions available</span>
        <span className={cn("text-[13px] font-bold tabular-nums", balance === 0 ? "text-red-500" : "text-slate-900")}>
          {balance} session{balance !== 1 ? "s" : ""}
        </span>
      </div>

      {hasSessions ? (
        <Link
          href="/dashboard/interview/setup?type=live"
          className="mt-3 inline-flex items-center justify-center rounded-lg bg-orange-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-orange-600"
        >
          Start live interview
        </Link>
      ) : (
        <div className="mt-3 space-y-1.5">
          <p className="text-center text-[12px] text-slate-500">
            Buy a session to get started.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <BuyCreditsButton pack="session_short_1" label="30-min — $12" />
            <BuyCreditsButton pack="session_short_3" label="3×30min — $30" highlight />
          </div>
        </div>
      )}

      <p className="mt-2 text-center text-[10px] text-slate-400">
        $12 / 30-min session · $20 / 60-min session
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InterviewHubCards() {
  const { isPro, isProMax, isLoading } = useSubscription()
  const { pushToast } = useToast()
  const searchParams = useSearchParams()

  const [credits, setCredits] = useState<CreditInfo>(null)

  // Show success toast if redirected back after credit purchase
  useEffect(() => {
    if (searchParams.get("credits") === "purchased") {
      const amount = searchParams.get("amount")
      pushToast({
        tone: "success",
        title: `${amount ?? ""} live interview credits added to your account.`,
      })
      // Remove query params without full reload
      const url = new URL(window.location.href)
      url.searchParams.delete("credits")
      url.searchParams.delete("amount")
      window.history.replaceState({}, "", url.toString())
    }
  }, [searchParams, pushToast])

  // Fetch credit balance for Pro Max users
  useEffect(() => {
    if (!isProMax) return
    fetch("/api/interview/credits/balance")
      .then((r) => r.json())
      .then((d) => setCredits({ balance: d.balance ?? 0, costs: d.costs ?? { short: 1, long: 1 } }))
      .catch(() => {})
  }, [isProMax])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-48 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* ── Text Interview ── */}
      {isPro ? (
        <div className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
            <MessageSquare className="h-5 w-5" strokeWidth={2} />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-500">
            Async chat with an AI interviewer.
          </p>
          <h3 className="mt-1 text-[15px] font-semibold text-slate-900">Text Interview</h3>
          <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-slate-500">
            Best for thinking through stories without time pressure. Type your answers, get probing follow-ups.
          </p>
          <Link
            href="/dashboard/interview/setup?type=text"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-orange-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-orange-600"
          >
            Start text interview
          </Link>
        </div>
      ) : (
        <LockedCard
          icon={MessageSquare}
          label="Text Interview"
          tagline="Async chat with an AI interviewer."
          description="Best for thinking through stories without time pressure. Type your answers, get probing follow-ups."
          requiredPlan="pro"
        />
      )}

      {/* ── Live Interview ── */}
      {isProMax ? (
        <LiveCard credits={credits} />
      ) : (
        <LockedCard
          icon={Video}
          label="Live Interview"
          tagline="Voice + webcam. Real pressure."
          description="Best for final-round prep. Speak your answers, hold eye contact, get real-time interviewer energy."
          requiredPlan="pro_max"
        />
      )}

      {/* ── Live Coding Test ── */}
      {isPro ? (
        <div className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
          <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-500">
            <Code2 className="h-5 w-5" strokeWidth={2} />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-orange-500">
            Voice interviewer. Code under the clock.
          </p>
          <h3 className="mt-1 text-[15px] font-semibold text-slate-900">Live Coding Test</h3>
          <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-slate-500">
            Python or JavaScript. A voice interviewer watches as you code — ask questions out loud, get probed on your approach and complexity.
          </p>
          <Link
            href="/dashboard/interview/setup?type=coding"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-orange-500 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-orange-600"
          >
            Start live coding test
          </Link>
        </div>
      ) : (
        <LockedCard
          icon={Code2}
          label="Live Coding Test"
          tagline="Voice interviewer. Code under the clock."
          description="Python or JavaScript. A voice interviewer watches as you code — ask questions out loud, get probed on your approach and complexity."
          requiredPlan="pro"
        />
      )}
    </div>
  )
}
