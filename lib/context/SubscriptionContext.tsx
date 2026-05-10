"use client"

import { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { Plan } from "@/lib/gates"
import { useAuth } from "@/lib/context/AuthContext"

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
  isProMax: boolean
  isProInternational: boolean // backwards-compat alias
}

const SubscriptionContext = createContext<SubscriptionState | null>(null)

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null)
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly" | null>(null)
  const [amountCents, setAmountCents] = useState<number | null>(null)
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false)
  const [trialDaysRemaining, setTrialDaysRemaining] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    if (authLoading) {
      setIsLoading(true)
      return () => {
        cancelled = true
      }
    }

    // Logged-out state: clear subscription snapshot immediately.
    if (!user?.id) {
      setPlan(null)
      setStatus(null)
      setCurrentPeriodEnd(null)
      setBillingInterval(null)
      setAmountCents(null)
      setCancelAtPeriodEnd(false)
      setTrialDaysRemaining(null)
      setIsLoading(false)
      return () => {
        cancelled = true
      }
    }

    setIsLoading(true)

    const load = async (attempt = 0): Promise<void> => {
      const res = await fetch("/api/subscription", {
        credentials: "include",
        cache: "no-store",
      })

      // Handle login/refresh races where auth cookie has not propagated yet.
      if (res.status === 401 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (!cancelled) await load(1)
        return
      }

      if (!res.ok) return
      const data = (await res.json()) as {
        plan?: string | null
        status?: string | null
        currentPeriodEnd?: string | null
        billingInterval?: "monthly" | "yearly" | null
        amountCents?: number | null
        cancelAtPeriodEnd?: boolean
        trialDaysRemaining?: number | null
      }
      if (cancelled) return

      if (data.plan) {
        const p = data.plan === "pro_international" ? "pro_max" : data.plan
        setPlan(p as Plan)
      } else {
        setPlan("free")
      }
      setStatus(data.status ?? null)
      setCurrentPeriodEnd(data.currentPeriodEnd ?? null)
      setBillingInterval(data.billingInterval ?? null)
      setAmountCents(typeof data.amountCents === "number" ? data.amountCents : null)
      setCancelAtPeriodEnd(Boolean(data.cancelAtPeriodEnd))
      setTrialDaysRemaining(typeof data.trialDaysRemaining === "number" ? data.trialDaysRemaining : null)
    }

    void load()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [authLoading, user?.id])

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
      isPro: plan === "pro" || plan === "pro_max",
      isProInternational: plan === "pro_max",
      isProMax: plan === "pro_max",
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
