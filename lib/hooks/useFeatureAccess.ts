"use client"

import { useCallback } from "react"
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
  const { plan, isLoading } = useSubscription()
  const { showUpgrade } = useUpgradeModal()

  const required = FEATURE_GATES[feature]
  const hasAccess =
    required === "public" || required === "auth"
      ? true // auth check handled by middleware/useAuth
      : canAccess(plan, feature)

  const showUpgradePrompt = useCallback(() => {
    showUpgrade(feature)
  }, [feature, showUpgrade])

  return {
    hasAccess,
    requiredPlan: requiredPlanFor(feature),
    isLoading,
    showUpgradePrompt,
  }
}
