"use client"

import { createContext, useCallback, useContext, useState } from "react"
import type { FeatureKey } from "@/lib/gates"

interface UpgradeModalState {
  open: boolean
  feature: FeatureKey | null
}

interface UpgradeModalContextValue {
  state: UpgradeModalState
  showUpgrade: (feature: FeatureKey) => void
  hideUpgrade: () => void
}

const UpgradeModalContext = createContext<UpgradeModalContextValue | null>(null)

export function UpgradeModalProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<UpgradeModalState>({ open: false, feature: null })

  const showUpgrade = useCallback((feature: FeatureKey) => {
    setState({ open: true, feature })
  }, [])

  const hideUpgrade = useCallback(() => {
    setState({ open: false, feature: null })
  }, [])

  return (
    <UpgradeModalContext.Provider value={{ state, showUpgrade, hideUpgrade }}>
      {children}
    </UpgradeModalContext.Provider>
  )
}

export function useUpgradeModal(): UpgradeModalContextValue {
  const ctx = useContext(UpgradeModalContext)
  if (!ctx) throw new Error("useUpgradeModal must be used within UpgradeModalProvider")
  return ctx
}
