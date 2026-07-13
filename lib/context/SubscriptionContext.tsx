"use client"

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
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
  const [refreshNonce, setRefreshNonce] = useState(0)
  const loadedForUserRef = useRef<string | null>(null)

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
      loadedForUserRef.current = null
      setRefreshNonce(0)
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

    const firstLoadForUser = loadedForUserRef.current !== user.id
    if (firstLoadForUser) setIsLoading(true)

    const load = async (attempt = 0): Promise<void> => {
      const res = await fetch("/api/subscription", {
        credentials: "include",
        cache: "no-store",
      })

      // Handle login/refresh races where auth cookie has not propagated yet.
      if (res.status === 401 && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250))
        if (!cancelled) await load(attempt + 1)
        return
      }

      // Network or transient backend failures should not leave the provider in
      // a permanent unknown state; keep the last known snapshot when available.
      if (!res.ok) {
        setPlan((prev) => prev ?? "free")
        return
      }
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

      // /api/subscription returns canceled rows too (the billing page needs
      // them for history/status display) — but a canceled or expired plan
      // grants NO entitlements. Mirror getPlanForUserId's server semantics:
      // paid statuses only, and the paid window must not have lapsed.
      // Without this, every useSubscription() consumer (gates, upsells,
      // paywalled sections) treated canceled subscribers as still paying.
      const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"])
      const withinPaidWindow =
        !data.currentPeriodEnd || new Date(data.currentPeriodEnd).getTime() > Date.now()
      if (data.plan && ENTITLED_STATUSES.has(data.status ?? "") && withinPaidWindow) {
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
        if (!cancelled) {
          loadedForUserRef.current = user.id
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [authLoading, user?.id, refreshNonce])

  useEffect(() => {
    if (!user?.id) return

    const refresh = () => setRefreshNonce((n) => n + 1)
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh()
    }
    const onFocus = () => refresh()

    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("focus", onFocus)

    // Stripe checkout returns with `?upgrade=success`; poll briefly so the
    // UI picks up webhook-driven entitlement changes without a manual refresh.
    let upgradePoll: number | null = null
    const params = new URLSearchParams(window.location.search)
    if (params.get("upgrade") === "success") {
      let attempts = 0
      upgradePoll = window.setInterval(() => {
        attempts += 1
        refresh()
        if (attempts >= 12 && upgradePoll) {
          window.clearInterval(upgradePoll)
          upgradePoll = null
        }
      }, 2500)
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("focus", onFocus)
      if (upgradePoll) window.clearInterval(upgradePoll)
    }
  }, [user?.id])

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
