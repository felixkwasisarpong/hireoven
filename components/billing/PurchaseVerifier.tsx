"use client"

import { useEffect } from "react"
import { useToast } from "@/components/ui/ToastProvider"

const VERIFIED_KEY = "hireoven:verified-checkout-sessions"

function fulfillmentToast(fulfilled: { kind?: string; credits?: number; plan?: string } | undefined) {
  switch (fulfilled?.kind) {
    case "subscription":
      return `Your ${fulfilled.plan === "pro_max" ? "Pro Max" : "Pro"} plan is active.`
    case "live_interview_credits":
      return `${fulfilled.credits} interview credit${fulfilled.credits === 1 ? "" : "s"} added to your balance.`
    case "feature_credit_pack":
      return `${fulfilled.credits} credits added to your account.`
    case "immigration_service":
      return "Your booking is confirmed."
    default:
      return "Your purchase is active."
  }
}

/**
 * Return-URL fulfillment fallback. Stripe checkout success URLs carry
 * session_id={CHECKOUT_SESSION_ID}; when the dashboard loads with one, we ask
 * the server to (idempotently) fulfill that session. If the webhook already
 * did the work this is a no-op — if the webhook was missed, this is what
 * guarantees the user actually receives what they paid for.
 */
export default function PurchaseVerifier() {
  const { pushToast } = useToast()

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get("session_id")
    if (!sessionId || !sessionId.startsWith("cs_")) return

    let verified: string[] = []
    try {
      verified = JSON.parse(window.sessionStorage.getItem(VERIFIED_KEY) ?? "[]")
    } catch { /* ignore */ }
    if (verified.includes(sessionId)) return

    void (async () => {
      try {
        const res = await fetch("/api/stripe/verify-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.ok) {
          try {
            window.sessionStorage.setItem(VERIFIED_KEY, JSON.stringify([...verified, sessionId].slice(-10)))
          } catch { /* ignore */ }
          pushToast({ tone: "success", title: fulfillmentToast(data.fulfilled) })
        }
        // Failures stay silent — the webhook remains the primary path and
        // Stripe retries it for days.
      } catch { /* ignore */ }
    })()
  }, [pushToast])

  return null
}
