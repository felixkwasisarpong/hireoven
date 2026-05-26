"use client"

import { Lock, Sparkles, Zap } from "lucide-react"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { FEATURE_DESCRIPTIONS, PLAN_NAMES, requiredPlanFor, type FeatureKey } from "@/lib/gates"

interface UpgradePromptProps {
  feature: FeatureKey
  variant?: "inline" | "overlay" | "banner"
  children?: React.ReactNode
  className?: string
}

// ── Inline ────────────────────────────────────────────────────────────────────

function InlinePrompt({ feature }: { feature: FeatureKey }) {
  const { showUpgrade } = useUpgradeModal()
  const plan = requiredPlanFor(feature)
  const planLabel = plan ? PLAN_NAMES[plan] : "Pro"

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.06)]">
      {/* Subtle gradient top strip */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#FF5C18] via-[#FF9A3C] to-violet-500" />

      <div className="flex items-center gap-3.5">
        {/* Icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#FF5C18]/10 to-violet-500/10 ring-1 ring-[#FF5C18]/20">
          <Lock className="h-4 w-4 text-[#FF5C18]" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-slate-900">{FEATURE_DESCRIPTIONS[feature]}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#FF5C18]/10 to-violet-500/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[#FF5C18]">
              <Sparkles className="h-2.5 w-2.5" />
              {planLabel}
            </span>
            <span className="text-[11px] text-slate-400">feature</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => showUpgrade(feature)}
          className="shrink-0 rounded-xl bg-gradient-to-r from-[#FF5C18] to-[#FF7A35] px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_4px_12px_rgba(255,92,24,0.3)] transition hover:shadow-[0_4px_16px_rgba(255,92,24,0.45)] hover:brightness-105 active:brightness-95"
        >
          Unlock
        </button>
      </div>
    </div>
  )
}

// ── Banner ────────────────────────────────────────────────────────────────────

function BannerPrompt({ feature }: { feature: FeatureKey }) {
  const { showUpgrade } = useUpgradeModal()
  const plan = requiredPlanFor(feature)
  const planLabel = plan ? PLAN_NAMES[plan] : "Pro"

  return (
    <div className="relative overflow-hidden rounded-xl border border-[#FF5C18]/20 bg-gradient-to-r from-[#FFF4EE] to-[#FFF8F5] px-4 py-2.5">
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-violet-50/40 to-transparent" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 shrink-0 text-[#FF5C18]" />
          <p className="text-[12.5px] text-slate-700">
            <span className="font-semibold text-[#FF5C18]">{planLabel}</span> unlocks{" "}
            {FEATURE_DESCRIPTIONS[feature].toLowerCase()}
          </p>
        </div>
        <button
          type="button"
          onClick={() => showUpgrade(feature)}
          className="shrink-0 rounded-lg bg-[#FF5C18] px-3 py-1.5 text-[11.5px] font-bold text-white shadow-sm transition hover:bg-[#E14F0E]"
        >
          Upgrade
        </button>
      </div>
    </div>
  )
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function OverlayPrompt({ feature, children }: { feature: FeatureKey; children?: React.ReactNode }) {
  const { showUpgrade } = useUpgradeModal()
  const plan = requiredPlanFor(feature)
  const planLabel = plan ? PLAN_NAMES[plan] : "Pro"

  return (
    <div className="relative isolate overflow-hidden rounded-2xl">
      {/* Blurred preview of locked content */}
      <div className="pointer-events-none select-none blur-[6px] brightness-95 saturate-50">
        {children}
      </div>

      {/* Frosted glass lock overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-white/40 backdrop-blur-[2px]">
        {/* Ambient glow behind card */}
        <div className="absolute h-48 w-48 rounded-full bg-[#FF5C18]/10 blur-3xl" />

        <div className="relative mx-4 w-full max-w-[280px] overflow-hidden rounded-2xl border border-white/80 bg-white/95 px-6 py-5 text-center shadow-[0_16px_48px_rgba(15,23,42,0.14)] backdrop-blur-md">
          {/* Top gradient bar */}
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#FF5C18] via-[#FF9A3C] to-violet-500" />

          {/* Lock icon */}
          <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#FF5C18] to-[#FF9A3C] shadow-[0_6px_20px_rgba(255,92,24,0.35)]">
            <Lock className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>

          {/* Plan badge */}
          <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-[#FF5C18]/10 to-violet-500/10 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider text-[#FF5C18] ring-1 ring-[#FF5C18]/20">
            <Sparkles className="h-2.5 w-2.5" />
            {planLabel} feature
          </span>

          <p className="mt-2.5 text-[13.5px] font-semibold leading-snug text-slate-900">
            {FEATURE_DESCRIPTIONS[feature]}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">
            Upgrade to <span className="font-semibold text-slate-700">{planLabel}</span> to unlock this and all premium features.
          </p>

          <button
            type="button"
            onClick={() => showUpgrade(feature)}
            className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#FF5C18] to-[#FF7A35] py-2.5 text-[13px] font-bold text-white shadow-[0_4px_16px_rgba(255,92,24,0.35)] transition hover:brightness-105 active:brightness-95"
          >
            <Zap className="h-3.5 w-3.5" />
            Unlock {planLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────────

export default function UpgradePrompt({ feature, variant = "inline", children, className }: UpgradePromptProps) {
  if (variant === "banner") return <BannerPrompt feature={feature} />
  if (variant === "overlay") return <OverlayPrompt feature={feature}>{children}</OverlayPrompt>
  return (
    <div className={className}>
      <InlinePrompt feature={feature} />
    </div>
  )
}
