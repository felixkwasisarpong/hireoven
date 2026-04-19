"use client"

import { Lock, Zap } from "lucide-react"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { FEATURE_DESCRIPTIONS, PLAN_NAMES, requiredPlanFor, type FeatureKey } from "@/lib/gates"

interface UpgradePromptProps {
  feature: FeatureKey
  variant?: "inline" | "overlay" | "banner"
  children?: React.ReactNode
  className?: string
}

function InlinePrompt({ feature }: { feature: FeatureKey }) {
  const { showUpgrade } = useUpgradeModal()
  const plan = requiredPlanFor(feature)

  return (
    <div className="flex items-center gap-3 rounded-[14px] border border-[#FFD2B8]/80 bg-[#FFF7F2] px-4 py-3">
      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#FFF1E8]">
        <Lock className="h-4 w-4 text-[#FF5C18]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{FEATURE_DESCRIPTIONS[feature]}</p>
        {plan && (
          <p className="mt-0.5 text-xs text-slate-500">
            Available on <span className="font-semibold text-[#FF5C18]">{PLAN_NAMES[plan]}</span>
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => showUpgrade(feature)}
        className="flex-shrink-0 rounded-lg bg-[#FF5C18] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#E14F0E]"
      >
        Upgrade
      </button>
    </div>
  )
}

function BannerPrompt({ feature }: { feature: FeatureKey }) {
  const { showUpgrade } = useUpgradeModal()
  const plan = requiredPlanFor(feature)

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-[#FFD2B8] bg-[#FFF1E8] px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm text-[#9A3412]">
        <Zap className="h-4 w-4 flex-shrink-0" />
        <span>
          Upgrade to{" "}
          <span className="font-semibold">{plan ? PLAN_NAMES[plan] : "Pro"}</span> to unlock{" "}
          {FEATURE_DESCRIPTIONS[feature].toLowerCase()}
        </span>
      </div>
      <button
        type="button"
        onClick={() => showUpgrade(feature)}
        className="flex-shrink-0 rounded-lg bg-[#FF5C18] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#E14F0E]"
      >
        Upgrade
      </button>
    </div>
  )
}

function OverlayPrompt({ feature, children }: { feature: FeatureKey; children?: React.ReactNode }) {
  const { showUpgrade } = useUpgradeModal()
  const plan = requiredPlanFor(feature)

  return (
    <div className="relative overflow-hidden rounded-[20px]">
      <div className="pointer-events-none select-none blur-[3px]">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-[1px]">
        <div className="mx-auto w-fit rounded-[18px] border border-[#FFD2B8] bg-white px-6 py-5 text-center shadow-[0_8px_28px_rgba(15,23,42,0.1)]">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF1E8]">
            <Lock className="h-5 w-5 text-[#FF5C18]" />
          </div>
          <p className="text-sm font-semibold text-slate-900">{FEATURE_DESCRIPTIONS[feature]}</p>
          {plan && (
            <p className="mt-1 text-xs text-slate-500">
              Requires <span className="font-medium text-[#FF5C18]">{PLAN_NAMES[plan]}</span>
            </p>
          )}
          <button
            type="button"
            onClick={() => showUpgrade(feature)}
            className="mt-4 flex items-center gap-1.5 rounded-xl bg-[#FF5C18] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#E14F0E]"
          >
            <Zap className="h-3.5 w-3.5" />
            Upgrade
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UpgradePrompt({ feature, variant = "inline", children, className }: UpgradePromptProps) {
  if (variant === "banner") return <BannerPrompt feature={feature} />
  if (variant === "overlay") return <OverlayPrompt feature={feature}>{children}</OverlayPrompt>
  return (
    <div className={className}>
      <InlinePrompt feature={feature} />
    </div>
  )
}
