"use client"

import { useEffect, useState } from "react"
import type { Plan } from "@/lib/gates"

interface SubscriptionState {
  plan: Plan | null
  isLoading: boolean
  isPro: boolean
  isProInternational: boolean
}

export function useSubscription(): SubscriptionState {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetch("/api/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.plan) setPlan(data.plan as Plan)
      })
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [])

  return {
    plan,
    isLoading,
    isPro: plan === "pro" || plan === "pro_international",
    isProInternational: plan === "pro_international",
  }
}
