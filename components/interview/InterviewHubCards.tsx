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

type Mode = "text" | "live" | "coding"

const MODE_STYLES: Record<Mode, {
  accent: string
  shell: string
  surface: string
  glow: string
  iconBg: string
  iconColor: string
  chip: string
  title: string
  description: string
  bestForLabel: string
  bestForValue: string
  button: string
  lockOverlay: string
  lockBtn: string
  bestFor: string
}> = {
  text: {
    accent: "bg-gradient-to-r from-[#ff8f2b] via-[#ff6a3d] to-[#ff8a63]",
    shell: "border-[#ffd7c4] bg-[#fffaf7] shadow-[0_14px_34px_rgba(255,129,66,0.14)]",
    surface: "bg-[radial-gradient(circle_at_6%_4%,rgba(255,196,165,0.45),transparent_46%)]",
    glow: "bg-[radial-gradient(circle_at_94%_6%,rgba(255,164,114,0.24),transparent_52%)]",
    iconBg: "bg-white/95 ring-1 ring-[#ffd8c8]",
    iconColor: "text-[#ef5f2a]",
    chip: "bg-white/90 text-[#d84d1f] ring-1 ring-[#ffd1bf]",
    title: "text-slate-900",
    description: "text-slate-600",
    bestForLabel: "text-slate-400",
    bestForValue: "text-slate-600",
    button: "bg-[#f26c2f] text-white hover:bg-[#e35b1f]",
    lockOverlay: "bg-white/90",
    lockBtn: "bg-slate-900 text-white hover:bg-slate-700",
    bestFor: "Story crafting · no time pressure",
  },
  live: {
    accent: "bg-gradient-to-r from-slate-200 via-white to-slate-300",
    shell: "border-[#2a2a2f] bg-[#09090b] shadow-[0_24px_65px_rgba(2,6,23,0.65)]",
    surface: "bg-[radial-gradient(circle_at_12%_-4%,rgba(148,163,184,0.2),transparent_42%)]",
    glow: "bg-[radial-gradient(circle_at_88%_6%,rgba(255,255,255,0.1),transparent_48%)]",
    iconBg: "bg-white/5 ring-1 ring-white/10",
    iconColor: "text-slate-100",
    chip: "bg-white/10 text-slate-200 ring-1 ring-white/15",
    title: "text-white",
    description: "text-slate-300",
    bestForLabel: "text-slate-500",
    bestForValue: "text-slate-300",
    button: "bg-white text-slate-950 hover:bg-slate-200",
    lockOverlay: "bg-[#0b0b0d]/88",
    lockBtn: "bg-white text-slate-950 hover:bg-slate-200",
    bestFor: "Final-round prep · real pressure",
  },
  coding: {
    accent: "bg-gradient-to-r from-amber-300 via-amber-500 to-orange-500",
    shell: "border-amber-200 bg-amber-50/60 shadow-[0_14px_32px_rgba(245,158,11,0.14)]",
    surface: "bg-[radial-gradient(circle_at_14%_2%,rgba(255,229,159,0.45),transparent_44%)]",
    glow: "bg-[radial-gradient(circle_at_90%_8%,rgba(253,186,116,0.3),transparent_46%)]",
    iconBg: "bg-white/95 ring-1 ring-amber-200",
    iconColor: "text-amber-600",
    chip: "bg-white/90 text-amber-700 ring-1 ring-amber-200",
    title: "text-slate-900",
    description: "text-slate-600",
    bestForLabel: "text-slate-400",
    bestForValue: "text-slate-600",
    button: "bg-amber-500 text-white hover:bg-amber-600",
    lockOverlay: "bg-white/90",
    lockBtn: "bg-slate-900 text-white hover:bg-slate-700",
    bestFor: "Algorithm rounds · think out loud",
  },
}

function BuyCreditsButton({
  pack,
  label,
  highlight = false,
  tone = "light",
}: {
  pack: string
  label: string
  highlight?: boolean
  tone?: "light" | "dark"
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
        "inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-semibold transition disabled:opacity-60",
        tone === "dark"
          ? highlight
            ? "bg-white text-slate-950 hover:bg-slate-200"
            : "border border-white/20 bg-white/5 text-slate-200 hover:bg-white/10"
          : highlight
            ? "bg-violet-600 text-white hover:bg-violet-700"
            : "border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
      )}
    >
      <CreditCard className="h-3.5 w-3.5" />
      {loading ? "Redirecting…" : label}
    </button>
  )
}

function LockedCard({
  icon: Icon,
  mode,
  label,
  tagline,
  description,
  requiredPlan,
}: {
  icon: React.ElementType
  mode: Mode
  label: string
  tagline: string
  description: string
  requiredPlan: "pro" | "pro_max"
}) {
  const s = MODE_STYLES[mode]
  const badge = requiredPlan === "pro_max" ? "Pro Max" : "Pro"
  const upgradeHref = `/dashboard/upgrade?plan=${requiredPlan}`

  return (
    <div className={cn("group relative flex flex-col overflow-hidden rounded-[24px] border", s.shell)}>
      <div className={cn("h-1.5 w-full", s.accent)} />
      <div className={cn("pointer-events-none absolute inset-0", s.glow)} />

      <div className={cn("absolute inset-0 top-1.5 z-10 flex flex-col items-center justify-center gap-1 rounded-b-[24px] px-5 text-center backdrop-blur-sm", s.lockOverlay)}>
        <Lock className={cn("mb-1 h-5 w-5", mode === "live" ? "text-slate-300" : "text-slate-400")} />
        <span className={cn(
          "rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
          requiredPlan === "pro_max" ? "bg-violet-600 text-white" : "bg-[#FF5C18] text-white"
        )}>
          {badge}
        </span>
        <p className={cn("text-[12px]", mode === "live" ? "text-slate-300" : "text-slate-500")}>
          {requiredPlan === "pro_max"
            ? "Upgrade to Pro Max to unlock."
            : "Upgrade to Pro to unlock."}
        </p>
        <Link
          href={upgradeHref}
          className={cn("mt-2 rounded-xl px-4 py-1.5 text-[12px] font-semibold transition", s.lockBtn)}
        >
          Upgrade
        </Link>
      </div>

      <div className={cn("relative flex flex-1 flex-col p-5", s.surface)}>
        <div className={cn("mb-3 flex h-11 w-11 items-center justify-center rounded-2xl", s.iconBg)}>
          <Icon className={cn("h-5 w-5", s.iconColor)} strokeWidth={2} />
        </div>
        <span className={cn("mb-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", s.chip)}>
          {mode}
        </span>
        <h3 className={cn("text-[15px] font-bold", s.title)}>{label}</h3>
        <p className={cn("mt-1.5 text-[12px] uppercase tracking-[0.18em]", mode === "live" ? "text-slate-500" : "text-slate-400")}>
          {tagline}
        </p>
        <p className={cn("mt-2.5 flex-1 text-[13px] leading-relaxed", s.description)}>{description}</p>
        <p className={cn("mt-3 text-[11px]", s.bestForLabel)}>
          Best for: <span className={s.bestForValue}>{s.bestFor}</span>
        </p>
        <div className={cn("mt-4 h-9 rounded-xl", mode === "live" ? "bg-white/10" : "bg-slate-100")} />
      </div>
    </div>
  )
}

function ModeCard({
  icon: Icon,
  mode,
  label,
  description,
  href,
  children,
}: {
  icon: React.ElementType
  mode: Mode
  label: string
  description: string
  href?: string
  children?: React.ReactNode
}) {
  const s = MODE_STYLES[mode]

  return (
    <div className={cn("group relative flex flex-col overflow-hidden rounded-[24px] border transition-all duration-300 hover:-translate-y-0.5", s.shell)}>
      <div className={cn("h-1.5 w-full", s.accent)} />
      <div className={cn("pointer-events-none absolute inset-0", s.glow)} />

      <div className={cn("relative flex flex-1 flex-col p-5", s.surface)}>
        <div className={cn("mb-3 flex h-11 w-11 items-center justify-center rounded-2xl", s.iconBg)}>
          <Icon className={cn("h-5 w-5", s.iconColor)} strokeWidth={2} />
        </div>
        <span className={cn("mb-2 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", s.chip)}>
          {mode}
        </span>
        <h3 className={cn("text-[16px] font-bold", s.title)}>{label}</h3>
        <p className={cn("mt-2 flex-1 text-[13px] leading-relaxed", s.description)}>{description}</p>
        <p className={cn("mt-3 text-[11px]", s.bestForLabel)}>
          Best for: <span className={s.bestForValue}>{s.bestFor}</span>
        </p>

        {children ?? (
          href && (
            <Link
              href={href}
              className={cn(
                "mt-4 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-[13px] font-semibold transition",
                s.button
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

function LiveCard({ credits, isProMax }: { credits: CreditInfo; isProMax: boolean }) {
  const s = MODE_STYLES.live
  const balance = credits?.balance ?? 0
  const hasSessions = balance >= 1

  return (
    <ModeCard
      icon={Video}
      mode="live"
      label="Live Interview"
      description="Speak your answers, hold eye contact, and navigate real pressure in a focused, recruiter-like room."
    >
      <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
        <span className="text-[12px] text-slate-400">Sessions available</span>
        <span className={cn("text-[13px] font-bold tabular-nums", balance === 0 ? "text-red-300" : "text-white")}>
          {balance} {balance === 1 ? "session" : "sessions"}
        </span>
      </div>

      {hasSessions ? (
        <Link
          href="/dashboard/interview/setup?type=live"
          className={cn("mt-3 inline-flex items-center justify-center rounded-xl px-4 py-2.5 text-[13px] font-semibold transition", s.button)}
        >
          Start live interview
        </Link>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-center text-[11px] text-slate-500">Buy a session to get started</p>
          <div className="grid grid-cols-2 gap-1.5">
            <BuyCreditsButton pack="session_short_1" label="30 min · $12" tone="dark" />
            <BuyCreditsButton pack="session_short_3" label="3 × 30 min · $30" tone="dark" highlight />
          </div>
        </div>
      )}

      <p className="mt-2 text-center text-[10px] text-slate-500">
        {isProMax
          ? "Pro Max includes 1 free credit every 28 days · extras: $12 / 30-min · $20 / 60-min"
          : "$12 / 30-min · $20 / 60-min"}
      </p>
    </ModeCard>
  )
}

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
          description="Type your answers, get sharp follow-ups, and refine your stories without clock pressure."
          href="/dashboard/interview/setup?type=text"
        />
      ) : (
        <LockedCard
          icon={MessageSquare}
          mode="text"
          label="Text Interview"
          tagline="Async chat with an AI interviewer"
          description="Type your answers, get probing follow-ups, and iterate your narratives before the real call."
          requiredPlan="pro"
        />
      )}

      <LiveCard credits={credits} isProMax={isProMax} />

      {isPro ? (
        <ModeCard
          icon={Code2}
          mode="coding"
          label="Live Coding Test"
          description="A voice interviewer watches as you code, probing on approach, complexity, and communication."
          href="/dashboard/interview/setup?type=coding"
        />
      ) : (
        <LockedCard
          icon={Code2}
          mode="coding"
          label="Live Coding Test"
          tagline="Voice interviewer. Code under the clock"
          description="A voice interviewer watches as you code, probing on approach, complexity, and communication."
          requiredPlan="pro"
        />
      )}
    </div>
  )
}
