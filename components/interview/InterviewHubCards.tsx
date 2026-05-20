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

// ── Per-mode design tokens ────────────────────────────────────────────────────

const MODE_STYLES = {
  text: {
    accent:     "bg-blue-500",
    iconBg:     "bg-blue-50",
    iconColor:  "text-blue-600",
    chip:       "bg-blue-50 text-blue-700",
    cardBg:     "from-blue-50/40 to-white",
    btn:        "bg-blue-600 hover:bg-blue-700 text-white",
    btnOutline: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
    tagColor:   "text-blue-600",
    bestFor:    "Story crafting · no time pressure",
  },
  live: {
    accent:     "bg-violet-500",
    iconBg:     "bg-violet-50",
    iconColor:  "text-violet-600",
    chip:       "bg-violet-50 text-violet-700",
    cardBg:     "from-violet-50/40 to-white",
    btn:        "bg-violet-600 hover:bg-violet-700 text-white",
    btnOutline: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
    tagColor:   "text-violet-600",
    bestFor:    "Final-round prep · real pressure",
  },
  coding: {
    accent:     "bg-amber-500",
    iconBg:     "bg-amber-50",
    iconColor:  "text-amber-600",
    chip:       "bg-amber-50 text-amber-700",
    cardBg:     "from-amber-50/40 to-white",
    btn:        "bg-amber-500 hover:bg-amber-600 text-white",
    btnOutline: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
    tagColor:   "text-amber-600",
    bestFor:    "Algorithm rounds · think out loud",
  },
} as const

// ── Buy credits button ────────────────────────────────────────────────────────

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
        "inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold transition disabled:opacity-60",
        highlight
          ? "bg-violet-600 text-white hover:bg-violet-700"
          : "border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
      )}
    >
      <CreditCard className="h-3.5 w-3.5" />
      {loading ? "Redirecting…" : label}
    </button>
  )
}

// ── Locked card ───────────────────────────────────────────────────────────────

function LockedCard({
  icon: Icon,
  mode,
  label,
  tagline,
  description,
  requiredPlan,
}: {
  icon: React.ElementType
  mode: "text" | "live" | "coding"
  label: string
  tagline: string
  description: string
  requiredPlan: "pro" | "pro_max"
}) {
  const s = MODE_STYLES[mode]
  const badge = requiredPlan === "pro_max" ? "Pro Max" : "Pro"
  const upgradeHref = `/dashboard/upgrade?plan=${requiredPlan}`

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Top accent bar */}
      <div className={cn("h-1 w-full", s.accent)} />

      {/* Lock overlay */}
      <div className="absolute inset-0 top-1 z-10 flex flex-col items-center justify-center rounded-b-2xl bg-white/90 backdrop-blur-[2px]">
        <Lock className="mb-2 h-5 w-5 text-slate-400" />
        <span className={cn(
          "rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
          requiredPlan === "pro_max" ? "bg-violet-600 text-white" : "bg-[#FF5C18] text-white"
        )}>
          {badge}
        </span>
        <p className="mt-1.5 max-w-[160px] text-center text-[12px] text-slate-500">
          {requiredPlan === "pro_max"
            ? "Upgrade to Pro Max to unlock."
            : "Upgrade to Pro to unlock."}
        </p>
        <Link
          href={upgradeHref}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-1.5 text-[12px] font-semibold text-white transition hover:bg-slate-700"
        >
          Upgrade
        </Link>
      </div>

      {/* Card content (blurred behind) */}
      <div className={cn("flex flex-1 flex-col bg-gradient-to-b p-5", s.cardBg)}>
        <div className={cn("mb-3 flex h-11 w-11 items-center justify-center rounded-xl", s.iconBg)}>
          <Icon className={cn("h-5 w-5", s.iconColor)} strokeWidth={2} />
        </div>
        <span className={cn("mb-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", s.chip)}>
          {mode}
        </span>
        <h3 className="text-[15px] font-bold text-slate-900">{label}</h3>
        <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-slate-500">{description}</p>
        <p className="mt-3 text-[11px] text-slate-400">
          Best for: <span className="text-slate-500">{s.bestFor}</span>
        </p>
        <div className="mt-4 h-9 rounded-lg bg-slate-100" />
      </div>
    </div>
  )
}

// ── Unlocked card ─────────────────────────────────────────────────────────────

function ModeCard({
  icon: Icon,
  mode,
  label,
  description,
  href,
  children,
}: {
  icon: React.ElementType
  mode: "text" | "live" | "coding"
  label: string
  description: string
  href?: string
  children?: React.ReactNode
}) {
  const s = MODE_STYLES[mode]

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {/* Top accent bar */}
      <div className={cn("h-1 w-full", s.accent)} />

      <div className={cn("flex flex-1 flex-col bg-gradient-to-b p-5", s.cardBg)}>
        <div className={cn("mb-3 flex h-11 w-11 items-center justify-center rounded-xl", s.iconBg)}>
          <Icon className={cn("h-5 w-5", s.iconColor)} strokeWidth={2} />
        </div>
        <span className={cn("mb-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", s.chip)}>
          {mode}
        </span>
        <h3 className="text-[15px] font-bold text-slate-900">{label}</h3>
        <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-slate-500">{description}</p>
        <p className="mt-3 text-[11px] text-slate-400">
          Best for: <span className="text-slate-500">{s.bestFor}</span>
        </p>

        {children ?? (
          href && (
            <Link
              href={href}
              className={cn(
                "mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2 text-[13px] font-semibold transition",
                s.btn
              )}
            >
              Start {mode} interview
            </Link>
          )
        )}
      </div>
    </div>
  )
}

// ── Live card (needs credit balance) ─────────────────────────────────────────

function LiveCard({ credits }: { credits: CreditInfo }) {
  const s = MODE_STYLES.live
  const balance = credits?.balance ?? 0
  const hasSessions = balance >= 1

  return (
    <ModeCard
      icon={Video}
      mode="live"
      label="Live Interview"
      description="Speak your answers, hold eye contact, get real-time interviewer energy. The closest thing to the real room."
    >
      <div className="mt-3 flex items-center justify-between rounded-lg bg-white/70 px-3 py-2 ring-1 ring-slate-100">
        <span className="text-[12px] text-slate-500">Sessions available</span>
        <span className={cn("text-[13px] font-bold tabular-nums", balance === 0 ? "text-red-500" : "text-slate-900")}>
          {balance} {balance === 1 ? "session" : "sessions"}
        </span>
      </div>

      {hasSessions ? (
        <Link
          href="/dashboard/interview/setup?type=live"
          className={cn("mt-3 inline-flex items-center justify-center rounded-lg px-4 py-2 text-[13px] font-semibold transition", s.btn)}
        >
          Start live interview
        </Link>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-center text-[11px] text-slate-400">Buy a session to get started</p>
          <div className="grid grid-cols-2 gap-1.5">
            <BuyCreditsButton pack="session_short_1" label="30 min · $12" />
            <BuyCreditsButton pack="session_short_3" label="3 × 30 min · $30" highlight />
          </div>
        </div>
      )}

      <p className="mt-2 text-center text-[10px] text-slate-400">
        $12 / 30-min · $20 / 60-min
      </p>
    </ModeCard>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function InterviewHubCards() {
  const { isPro, isProMax, isLoading } = useSubscription()
  const { pushToast } = useToast()
  const searchParams = useSearchParams()
  const [credits, setCredits] = useState<CreditInfo>(null)

  useEffect(() => {
    if (searchParams.get("credits") === "purchased") {
      const amount = searchParams.get("amount")
      pushToast({ tone: "success", title: `${amount ?? ""} live interview credits added.` })
      const url = new URL(window.location.href)
      url.searchParams.delete("credits")
      url.searchParams.delete("amount")
      window.history.replaceState({}, "", url.toString())
    }
  }, [searchParams, pushToast])

  useEffect(() => {
    fetch("/api/interview/credits/balance")
      .then((r) => r.json())
      .then((d) => setCredits({ balance: d.balance ?? 0, costs: d.costs ?? { short: 1, long: 1 } }))
      .catch(() => {})
  }, [])

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-56 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {isPro ? (
        <ModeCard
          icon={MessageSquare}
          mode="text"
          label="Text Interview"
          description="Type your answers, get probing follow-ups. Best for refining your stories without the clock pressure."
          href="/dashboard/interview/setup?type=text"
        />
      ) : (
        <LockedCard
          icon={MessageSquare}
          mode="text"
          label="Text Interview"
          tagline="Async chat with an AI interviewer."
          description="Type your answers, get probing follow-ups. Best for refining your stories without the clock pressure."
          requiredPlan="pro"
        />
      )}

      {isProMax ? (
        <LiveCard credits={credits} />
      ) : (
        <LockedCard
          icon={Video}
          mode="live"
          label="Live Interview"
          tagline="Voice + webcam. Real pressure."
          description="Speak your answers, hold eye contact, get real-time interviewer energy."
          requiredPlan="pro_max"
        />
      )}

      {isPro ? (
        <ModeCard
          icon={Code2}
          mode="coding"
          label="Live Coding Test"
          description="A voice interviewer watches as you code. Ask questions out loud, get probed on approach and complexity."
          href="/dashboard/interview/setup?type=coding"
        />
      ) : (
        <LockedCard
          icon={Code2}
          mode="coding"
          label="Live Coding Test"
          tagline="Voice interviewer. Code under the clock."
          description="A voice interviewer watches as you code. Ask questions out loud, get probed on approach and complexity."
          requiredPlan="pro"
        />
      )}
    </div>
  )
}
