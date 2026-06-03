"use client"

const EXT_KEY     = "hireoven:apex:ext-promo-dismissed:v1"
const WELCOME_KEY = "hireoven:apex:welcome-seen:v1"

// ── Extension promo ───────────────────────────────────────────────────────────

export function isExtPromosDismissed(): boolean {
  if (typeof window === "undefined") return false
  try { return !!localStorage.getItem(EXT_KEY) } catch { return false }
}

export function dismissExtPromo(): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(EXT_KEY, "1") } catch {}
}

// ── First-run welcome message ─────────────────────────────────────────────────

export function isApexWelcomeSeen(): boolean {
  if (typeof window === "undefined") return true
  try { return !!localStorage.getItem(WELCOME_KEY) } catch { return true }
}

export function markApexWelcomeSeen(): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(WELCOME_KEY, "1") } catch {}
}
