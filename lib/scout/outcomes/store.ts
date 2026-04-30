/**
 * Outcome learning preferences — localStorage only.
 * No sensitive outcome data stored here — only user preferences and flags.
 */

const KEY_DISABLED = "hireoven:scout-outcome-learning:disabled:v1"
const KEY_DISMISSED = "hireoven:scout-feedback-dismissed:v1"
const MAX_DISMISSED = 50

export function isOutcomeLearningDisabled(): boolean {
  if (typeof window === "undefined") return false
  try { return localStorage.getItem(KEY_DISABLED) === "true" } catch { return false }
}

export function setOutcomeLearningDisabled(disabled: boolean): void {
  if (typeof window === "undefined") return
  try {
    if (disabled) localStorage.setItem(KEY_DISABLED, "true")
    else          localStorage.removeItem(KEY_DISABLED)
  } catch {}
}

/** Track which application IDs the user has dismissed feedback prompts for. */
export function dismissFeedbackPrompt(applicationId: string): void {
  if (typeof window === "undefined") return
  try {
    const raw = localStorage.getItem(KEY_DISMISSED)
    const list: string[] = raw ? JSON.parse(raw) : []
    if (!list.includes(applicationId)) {
      list.unshift(applicationId)
      localStorage.setItem(KEY_DISMISSED, JSON.stringify(list.slice(0, MAX_DISMISSED)))
    }
  } catch {}
}

export function isFeedbackDismissed(applicationId: string): boolean {
  if (typeof window === "undefined") return false
  try {
    const raw = localStorage.getItem(KEY_DISMISSED)
    const list: string[] = raw ? JSON.parse(raw) : []
    return list.includes(applicationId)
  } catch { return false }
}

export function clearOutcomeLearningData(): void {
  if (typeof window === "undefined") return
  try {
    localStorage.removeItem(KEY_DISABLED)
    localStorage.removeItem(KEY_DISMISSED)
  } catch {}
}
