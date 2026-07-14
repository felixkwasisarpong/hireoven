import { useEffect } from "react"

const CLAIMED_KEY = "hireoven:ref_claimed"

export function useReferralClaim() {
  useEffect(() => {
    // Only run once per session (localStorage guard)
    try {
      if (localStorage.getItem(CLAIMED_KEY)) return
    } catch { /* ignore */ }

    const match = document.cookie.match(/(?:^|;\s*)hireoven_ref=([^;]+)/)
    const code = match?.[1]
    if (!code) return

    void fetch("/api/referral/claim", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    }).then((res) => {
      if (res.ok || res.status === 400) {
        // 400 = already claimed / self-referral — clear cookie either way
        document.cookie = "hireoven_ref=; Path=/; Max-Age=0; SameSite=Lax"
        try { localStorage.setItem(CLAIMED_KEY, "1") } catch { /* ignore */ }
      }
    }).catch(() => { /* best-effort */ })
  }, [])
}
