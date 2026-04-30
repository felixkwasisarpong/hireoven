"use client"

/**
 * Scout First-Run Detection — V1
 *
 * Tracks whether a user has used Scout OS before. Used to show contextual
 * onboarding hints on the first session only.
 *
 * Approach: opt-in mark — we write a flag when the user completes their
 * first command. Before that flag exists → first-run mode is active.
 *
 * Privacy: stores only a timestamp — never user content or PII.
 */

const KEY         = "hireoven:scout:onboarded:v1"
const BANNER_KEY  = "hireoven:scout:banner-dismissed:v1"
const EXT_KEY     = "hireoven:scout:ext-promo-dismissed:v1"

// ── First-run state ───────────────────────────────────────────────────────────

/** True if the user has never completed a Scout command. */
export function isFirstRun(): boolean {
  if (typeof window === "undefined") return false
  try { return !localStorage.getItem(KEY) } catch { return false }
}

/** Mark this user as onboarded. Call after their first Scout command. */
export function markOnboarded(): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(KEY, new Date().toISOString()) } catch {}
}

// ── First-run banner ──────────────────────────────────────────────────────────

export function isFirstRunBannerDismissed(): boolean {
  if (typeof window === "undefined") return false
  try { return !!localStorage.getItem(BANNER_KEY) } catch { return false }
}

export function dismissFirstRunBanner(): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(BANNER_KEY, "1") } catch {}
}

// ── Extension promo ───────────────────────────────────────────────────────────

export function isExtPromosDismissed(): boolean {
  if (typeof window === "undefined") return false
  try { return !!localStorage.getItem(EXT_KEY) } catch { return false }
}

export function dismissExtPromo(): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(EXT_KEY, "1") } catch {}
}
