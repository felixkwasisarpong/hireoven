"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowRight,
  Check,
  ChevronRight,
  Code2,
  CreditCard,
  Info,
  MessageSquare,
  Video,
} from "lucide-react"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"

type CreditInfo = {
  balance: number
  costs: { short: number; long: number }
} | null

type Mode = "text" | "live" | "coding"

type ModeConfig = {
  id: Mode
  title: string
  selectorTitle: string
  selectorSub: string
  badge: string
  bestFor: string
  desc: string
  features: string[]
  meta: string
  ctaLabel: string
  href: string
  accent: string
  glow: string
  badgeBg: string
  badgeBorder: string
  iconBg: string
  ctaBg: string
  ctaText: string
  tileBg: string
  tileBorder: string
  tileIcon: string
  icon: React.ElementType
  popular?: boolean
}

const MODES: Record<Mode, ModeConfig> = {
  text: {
    id: "text",
    title: "Text Interview",
    selectorTitle: "Text Interview",
    selectorSub: "Free · unlimited runs",
    badge: "TEXT MODE",
    bestFor: "Story crafting, no time pressure",
    desc: "Type your answers, get sharp follow-ups, and refine your stories without clock pressure.",
    features: [
      "Unlimited adaptive follow-ups",
      "No timer - rewrite freely",
      "Saved transcript + debrief",
    ],
    meta: "Free · unlimited runs · counts toward your weekly streak",
    ctaLabel: "Start text interview",
    href: "/dashboard/interview/setup?type=text",
    accent: "#f6953f",
    glow: "rgba(236,101,22,.34)",
    badgeBg: "rgba(236,101,22,.16)",
    badgeBorder: "rgba(246,149,63,.32)",
    iconBg: "rgba(236,101,22,.14)",
    ctaBg: "linear-gradient(180deg,#f8a657,#ec6516)",
    ctaText: "#2a1405",
    tileBg: "#fff3ea",
    tileBorder: "#ffdcc4",
    tileIcon: "#ec6516",
    icon: MessageSquare,
  },
  live: {
    id: "live",
    title: "Live Interview",
    selectorTitle: "Live Interview",
    selectorSub: "sessions available",
    badge: "LIVE · VOICE & VIDEO",
    bestFor: "Final-round prep, real pressure",
    desc: "Speak your answers, hold eye contact, and navigate real pressure in a focused, recruiter-like room.",
    features: [
      "Real-time voice & video room",
      "Recruiter-style pressure & pacing",
      "Instant tone & delivery debrief",
    ],
    meta: "Pro Max: 1 free credit / 28 days · extras $12 / 30-min · $20 / 60-min",
    ctaLabel: "Start live interview",
    href: "/dashboard/interview/setup?type=live",
    accent: "#38bdf8",
    glow: "rgba(56,189,248,.40)",
    badgeBg: "rgba(56,189,248,.16)",
    badgeBorder: "rgba(125,211,252,.30)",
    iconBg: "rgba(56,189,248,.14)",
    ctaBg: "linear-gradient(180deg,#5fcbfb,#0ea5e9)",
    ctaText: "#04253c",
    tileBg: "#eef7ff",
    tileBorder: "#c4e3fb",
    tileIcon: "#0ea5e9",
    icon: Video,
    popular: true,
  },
  coding: {
    id: "coding",
    title: "Live Coding Test",
    selectorTitle: "Live Coding Test",
    selectorSub: "Algorithm rounds",
    badge: "CODING · LIVE EDITOR",
    bestFor: "Algorithm rounds, think out loud",
    desc: "A voice interviewer watches as you code, probing on approach, complexity, and communication.",
    features: [
      "Voice interviewer + live editor",
      "Probes approach & complexity",
      "Think-out-loud scoring",
    ],
    meta: "Algorithm & systems rounds · supports 12 languages",
    ctaLabel: "Start coding interview",
    href: "/dashboard/interview/setup?type=coding",
    accent: "#34d399",
    glow: "rgba(52,211,153,.34)",
    badgeBg: "rgba(52,211,153,.16)",
    badgeBorder: "rgba(52,211,153,.30)",
    iconBg: "rgba(52,211,153,.14)",
    ctaBg: "linear-gradient(180deg,#54e0ad,#0f9d6a)",
    ctaText: "#04241a",
    tileBg: "#ecfdf5",
    tileBorder: "#bbf3da",
    tileIcon: "#0f9d6a",
    icon: Code2,
  },
}

const MODE_ORDER: Mode[] = ["text", "live", "coding"]
const WAVE_DELAYS = [0, 120, 240, 360, 180, 300, 80, 420, 220, 340, 140, 400]

function liveSubLabel(credits: CreditInfo) {
  if (!credits) return "Checking sessions"
  return `${credits.balance} ${credits.balance === 1 ? "session" : "sessions"} available`
}

function BuyCreditsButton({
  pack,
  label,
  highlight = false,
}: {
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
        "inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[12px] font-semibold transition active:translate-y-px disabled:opacity-60",
        highlight
          ? "border border-sky-300 bg-sky-400 text-slate-950 hover:bg-sky-300"
          : "border border-white/15 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]"
      )}
    >
      <CreditCard className="h-3.5 w-3.5" />
      {loading ? "Redirecting..." : label}
    </button>
  )
}

function ModeSelectorRow({
  mode,
  active,
  credits,
  onSelect,
}: {
  mode: ModeConfig
  active: boolean
  credits: CreditInfo
  onSelect: () => void
}) {
  const Icon = mode.icon
  const sub = mode.id === "live" ? liveSubLabel(credits) : mode.selectorSub

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-[13px] rounded-2xl border px-[15px] py-3.5 text-left transition active:translate-y-px",
        active
          ? "border-[#d7dde6] bg-white shadow-[0_18px_38px_-22px_rgba(15,23,42,.5)]"
          : "border-[#eef0f4] bg-[#f4f6f9] hover:border-[#dfe3ea] hover:bg-white"
      )}
      style={active ? { boxShadow: `0 18px 38px -22px rgba(15,23,42,.5), inset 3px 0 0 ${mode.accent}` } : undefined}
      aria-pressed={active}
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border"
        style={{ backgroundColor: mode.tileBg, borderColor: mode.tileBorder, color: mode.tileIcon }}
      >
        <Icon className="h-5 w-5" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2 text-[15px] font-bold text-[#0f1729]">
          <span className="truncate">{mode.selectorTitle}</span>
          {mode.popular ? (
            <span className="shrink-0 rounded-full bg-[#e0f2fe] px-[7px] py-0.5 text-[9.5px] font-extrabold uppercase tracking-[0.08em] text-[#0369a1]">
              Popular
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[12.5px] text-[#98a1b0]">{sub}</span>
      </span>
      <ChevronRight
        className="h-[17px] w-[17px] shrink-0"
        color={active ? "#0f1729" : "#c2c9d4"}
        strokeWidth={2.4}
        aria-hidden
      />
    </button>
  )
}

function StagePanel({
  mode,
  credits,
}: {
  mode: ModeConfig
  credits: CreditInfo
}) {
  const Icon = mode.icon
  const liveNeedsCredits = mode.id === "live" && credits !== null && credits.balance < 1

  return (
    <section
      className="relative flex min-h-[458px] flex-col overflow-hidden rounded-3xl border border-white/[0.08] bg-[linear-gradient(165deg,#141d31,#090e19)] px-6 py-7 shadow-[0_40px_80px_-34px_rgba(8,16,32,.7)] sm:px-[34px] sm:py-8"
      aria-live="polite"
    >
      <div
        className="pointer-events-none absolute -top-[90px] right-0 h-[340px] w-[340px] rounded-full sm:-right-[70px]"
        style={{ background: `radial-gradient(circle, ${mode.glow}, transparent 68%)` }}
      />

      <div className="relative flex items-center justify-between gap-4">
        <span
          className="inline-flex items-center gap-[9px] rounded-full border px-[13px] py-1.5 text-[11px] font-extrabold uppercase tracking-[0.1em]"
          style={{ backgroundColor: mode.badgeBg, borderColor: mode.badgeBorder, color: mode.accent }}
        >
          <span className="relative h-[7px] w-[7px]">
            <span className="interview-ping absolute inset-0 rounded-full" style={{ backgroundColor: mode.accent }} />
            <span className="absolute inset-0 rounded-full" style={{ backgroundColor: mode.accent }} />
          </span>
          {mode.badge}
        </span>
        <div className="flex h-[30px] items-end gap-[3px] opacity-90" style={{ color: mode.accent }} aria-hidden>
          {WAVE_DELAYS.map((delay, index) => (
            <span
              key={`${delay}-${index}`}
              className="interview-wave h-full w-[3px] origin-bottom rounded-sm bg-current"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>

      <div className="relative mt-[26px] flex items-center gap-[18px]">
        <span
          className="flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-[17px] border"
          style={{ backgroundColor: mode.iconBg, borderColor: mode.badgeBorder, color: mode.accent }}
        >
          <Icon className="h-7 w-7" strokeWidth={2} aria-hidden />
        </span>
        <div>
          <h2 className="m-0 text-[28px] font-extrabold leading-[1.05] tracking-[-0.02em] text-white">
            {mode.title}
          </h2>
          <div className="mt-1 text-[13px] text-[#7f93ad]">
            <span className="font-semibold text-[#a9bace]">Best for</span> · {mode.bestFor}
          </div>
        </div>
      </div>

      <p className="relative mt-[22px] max-w-xl text-[15.5px] leading-[1.65] text-[#aebed3]">
        {mode.desc}
      </p>

      <div className="relative mt-6 flex flex-col gap-[13px]">
        {mode.features.map((feature) => (
          <div key={feature} className="flex items-center gap-3 text-[14.5px] font-medium text-[#d4dde9]">
            <span
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: mode.badgeBg }}
            >
              <Check className="h-3.5 w-3.5" color={mode.accent} strokeWidth={2.6} aria-hidden />
            </span>
            {feature}
          </div>
        ))}
      </div>

      <div className="relative mt-auto flex flex-col gap-5 border-t border-white/[0.09] pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[13px] leading-normal text-[#7f93ad]">
          {liveNeedsCredits ? "Buy a live credit to start this room." : mode.meta}
        </div>

        {liveNeedsCredits ? (
          <div className="grid shrink-0 grid-cols-2 gap-2">
            <BuyCreditsButton pack="session_short_1" label="30 min · $12" />
            <BuyCreditsButton pack="session_short_3" label="3 × 30 min · $30" highlight />
          </div>
        ) : (
          <Link
            href={mode.href}
            className="inline-flex h-[52px] shrink-0 items-center justify-center gap-2.5 rounded-[14px] px-7 text-[15px] font-bold transition hover:brightness-105 active:translate-y-px"
            style={{ background: mode.ctaBg, color: mode.ctaText, boxShadow: `0 16px 34px -14px ${mode.glow}` }}
          >
            {mode.ctaLabel}
            <ArrowRight className="h-[17px] w-[17px]" strokeWidth={2.4} aria-hidden />
          </Link>
        )}
      </div>

      <style>{`
        @keyframes interviewPing {
          0% { transform: scale(1); opacity: .6; }
          70%, 100% { transform: scale(2.6); opacity: 0; }
        }
        @keyframes interviewWave {
          0%, 100% { transform: scaleY(.35); }
          50% { transform: scaleY(1); }
        }
        .interview-ping { animation: interviewPing 1.6s ease-out infinite; }
        .interview-wave { animation: interviewWave 1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .interview-ping,
          .interview-wave {
            animation: none !important;
          }
        }
      `}</style>
    </section>
  )
}

export default function InterviewHubCards() {
  const { pushToast } = useToast()
  const searchParams = useSearchParams()
  const [credits, setCredits] = useState<CreditInfo>(null)
  const [selectedMode, setSelectedMode] = useState<Mode>("live")

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

  const modes = useMemo(() => MODE_ORDER.map((id) => MODES[id]), [])
  const activeMode = MODES[selectedMode]

  return (
    <div className="grid items-stretch gap-[22px] lg:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="flex flex-col">
        <div className="mb-3.5 pl-0.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[#9aa3b1]">
          Choose a mode
        </div>
        <div className="flex flex-1 flex-col gap-2.5">
          {modes.map((mode) => (
            <ModeSelectorRow
              key={mode.id}
              mode={mode}
              active={selectedMode === mode.id}
              credits={credits}
              onSelect={() => setSelectedMode(mode.id)}
            />
          ))}

          <div className="mt-auto rounded-[14px] border border-dashed border-[#e2e6ec] bg-[#fafbfc] px-4 py-[15px]">
            <div className="mb-1 flex items-center gap-2 text-[12.5px] font-bold text-[#3f4856]">
              <Info className="h-[15px] w-[15px] text-[#ec6516]" strokeWidth={2} aria-hidden />
              Every session ends in a debrief
            </div>
            <p className="text-[12px] leading-[1.55] text-[#98a1b0]">
              Strengths, gaps, and a focused checklist - saved to your history.
            </p>
          </div>
        </div>
      </aside>

      <StagePanel mode={activeMode} credits={credits} />
    </div>
  )
}
