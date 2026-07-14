import { useEffect } from "react"

const THROTTLE_MS = 5 * 60 * 1000
const KEY = "hireoven:activity_ping"

export function useActivityPing() {
  useEffect(() => {
    try {
      const last = Number(localStorage.getItem(KEY) ?? 0)
      if (Date.now() - last < THROTTLE_MS) return
    } catch {
      // localStorage unavailable (SSR guard / private browsing) — still ping
    }

    void fetch("/api/user/activity", { method: "POST" }).then((res) => {
      if (res.ok) {
        try { localStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
      }
    })
  }, [])
}
