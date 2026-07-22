"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

const VID_KEY = "ho_vid"

/** Get (or lazily create) a stable anonymous first-party visitor id. */
function getVisitorId(): string | null {
  try {
    let vid = localStorage.getItem(VID_KEY)
    if (!vid) {
      vid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
      localStorage.setItem(VID_KEY, vid)
    }
    return vid
  } catch {
    // localStorage blocked (private mode / disabled) — skip tracking rather than
    // fall back to a per-load id that would inflate the unique-visitor count.
    return null
  }
}

/**
 * First-party pageview beacon. Fires once per path (including client-side SPA
 * navigations) to /api/track/pageview. No cookies, no PII — just an anonymous
 * localStorage id, the path, and the referrer.
 */
export default function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname) return
    const visitorId = getVisitorId()
    if (!visitorId) return

    const payload = JSON.stringify({
      path: pathname,
      visitorId,
      referrer: typeof document !== "undefined" ? document.referrer || null : null,
    })

    try {
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon("/api/track/pageview", new Blob([payload], { type: "application/json" }))
      } else {
        void fetch("/api/track/pageview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        })
      }
    } catch {
      // Beacon best-effort — never throw into the render tree.
    }
  }, [pathname])

  return null
}
