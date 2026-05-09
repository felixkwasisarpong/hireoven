"use client"

const EXT_KEY = "hireoven:scout:ext-promo-dismissed:v1"

// ── Extension promo ───────────────────────────────────────────────────────────

export function isExtPromosDismissed(): boolean {
  if (typeof window === "undefined") return false
  try { return !!localStorage.getItem(EXT_KEY) } catch { return false }
}

export function dismissExtPromo(): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(EXT_KEY, "1") } catch {}
}
