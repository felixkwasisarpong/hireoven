/**
 * Client-side session interaction events. SessionQualityTracker listens for
 * these to enrich the per-session counts it posts to /api/apex/session-quality
 * (search_queries / apply_attempts / saved_jobs), which in turn power the
 * session-quality classification and the admin growth metrics.
 *
 * Safe to call from any client handler — no-ops during SSR.
 */

function dispatch(name: "hireoven:search" | "hireoven:apply" | "hireoven:save") {
  if (typeof window === "undefined") return
  try {
    window.dispatchEvent(new Event(name))
  } catch {
    // best-effort — never let telemetry break a user action
  }
}

/** A search was performed (query submitted). */
export function trackSearch() {
  dispatch("hireoven:search")
}

/** An apply attempt was started. */
export function trackApply() {
  dispatch("hireoven:apply")
}

/** A job was saved / watched. */
export function trackSave() {
  dispatch("hireoven:save")
}
