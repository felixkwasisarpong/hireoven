"use client"

import { useCallback } from "react"
import { useAuth } from "./useAuth"
import { useSubscription } from "./useSubscription"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { canAccess, FEATURE_GATES, requiredPlanFor, type FeatureKey } from "@/lib/gates"

interface FeatureAccess {
  hasAccess: boolean
  requiredPlan: ReturnType<typeof requiredPlanFor>
  isLoading: boolean
  showUpgradePrompt: () => void
}

export function useFeatureAccess(feature: FeatureKey): FeatureAccess {
  const { user, isLoading: authLoading } = useAuth()
  const { plan, isLoading: subLoading } = useSubscription()
  const { showUpgrade } = useUpgradeModal()

  const required = FEATURE_GATES[feature]
  const hasAccess =
    required === "public"
      ? Boolean(user)
      : required === "auth"
        ? Boolean(user)
        : canAccess(plan, feature)

  const showUpgradePrompt = useCallback(() => {
    showUpgrade(feature)
  }, [feature, showUpgrade])

  return {
    hasAccess,
    requiredPlan: requiredPlanFor(feature),
    isLoading: authLoading || subLoading,
    showUpgradePrompt,
  }
}
