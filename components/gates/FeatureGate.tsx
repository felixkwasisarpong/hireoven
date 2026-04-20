"use client"

import { useAuth } from "@/lib/hooks/useAuth"
import { useFeatureAccess } from "@/lib/hooks/useFeatureAccess"
import { FEATURE_GATES, type FeatureKey } from "@/lib/gates"
import AuthWall from "./AuthWall"
import UpgradePrompt from "./UpgradePrompt"

interface FeatureGateProps {
  feature: FeatureKey
  children: React.ReactNode
  fallback?: React.ReactNode
  promptVariant?: "inline" | "overlay" | "banner"
  authWallVariant?: "modal" | "page"
}

export default function FeatureGate({
  feature,
  children,
  fallback,
  promptVariant = "inline",
  authWallVariant = "page",
}: FeatureGateProps) {
  const { user, isLoading: authLoading } = useAuth()
  const { hasAccess, isLoading: subLoading } = useFeatureAccess(feature)

  if (authLoading || subLoading) return null

  const requiredLevel = FEATURE_GATES[feature]

  if ((requiredLevel === "auth" || requiredLevel === "pro" || requiredLevel === "pro_international") && !user) {
    if (fallback) return <>{fallback}</>
    return <AuthWall variant={authWallVariant} />
  }

  if (!hasAccess) {
    if (fallback) return <>{fallback}</>
    return (
      <UpgradePrompt feature={feature} variant={promptVariant}>
        {children}
      </UpgradePrompt>
    )
  }

  return <>{children}</>
}
