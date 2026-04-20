"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { Plan } from "@/lib/gates"

interface SubscriptionState {
  plan: Plan | null
  status: string | null
  currentPeriodEnd: string | null
  billingInterval: "monthly" | "yearly" | null
  amountCents: number | null
  cancelAtPeriodEnd: boolean
  trialDaysRemaining: number | null
  isLoading: boolean
  isPro: boolean
  isProInternational: boolean
}

const SubscriptionContext = createContext<SubscriptionState | null>(null)

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null)
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly" | null>(null)
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch("/api/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        if (data.plan) setPlan(data.plan as Plan)
        setStatus(data.status ?? null)
        setCurrentPeriodEnd(data.currentPeriodEnd ?? null)
        setBillingInterval(data.billingInterval ?? null)
        setAmountCents(typeof data.amountCents === "number" ? data.amountCents : null)
        setCancelAtPeriodEnd(Boolean(data.cancelAtPeriodEnd))
        setTrialDaysRemaining(typeof data.trialDaysRemaining === "number" ? data.trialDaysRemaining : null)
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  const value = useMemo<SubscriptionState>(
    () => ({
      plan,
      status,
      currentPeriodEnd,
      billingInterval,
      amountCents,
      cancelAtPeriodEnd,
      trialDaysRemaining,
      isLoading,
      isPro: plan === "pro" || plan === "pro_international",
      isProInternational: plan === "pro_international",
    }),
    [
      plan,
      status,
      currentPeriodEnd,
      billingInterval,
      amountCents,
      cancelAtPeriodEnd,
      trialDaysRemaining,
      isLoading,
    ]
  )

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>
}

export function useSubscription(): SubscriptionState {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) {
    throw new Error("useSubscription must be used within SubscriptionProvider")
  }
  return ctx
}
