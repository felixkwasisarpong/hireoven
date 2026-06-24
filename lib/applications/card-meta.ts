/**
 * Pure helpers that derive the "richer card" fields for the applications kanban
 * from the existing JobApplication shape — no schema changes required.
 *
 *   - salaryShort:    offer base → offered → expected, formatted "$190k" / "$1.2M"
 *   - daysInStage:    days since the latest status-change into the current status
 *   - nextAction:     soonest of upcoming interview / follow-up / offer deadline,
 *                     with a tone so the card can colour it (due / warn / neutral)
 *   - tags:           lightweight tags derived from source (e.g. Referral)
 *
 * Kept pure + dependency-free so the card stays dumb and this stays unit-tested.
 */

import type { JobApplication } from "@/types"

const DAY_MS = 86_400_000

export function salaryShort(app: JobApplication): string | null {
  const value =
    app.offer_details?.base_salary ??
    app.salary_offered ??
    app.salary_expected ??
    null
  if (!value || !Number.isFinite(value) || value <= 0) return null
  if (value >= 1_000_000) {
    const m = value / 1_000_000
    return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`
  }
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`
  return `$${Math.round(value)}`
}

/** Timestamp the application entered its current status, best-effort. */
function stageEnteredAt(app: JobApplication): string | null {
  const changes = (app.timeline ?? [])
    .filter((e) => e.type === "status_change" && e.status === app.status && e.date)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
  if (changes[0]) return changes[0].date
  if (app.status === "applied" && app.applied_at) return app.applied_at
  return app.updated_at ?? app.created_at ?? null
}

export function daysInStage(app: JobApplication, now: number = Date.now()): number | null {
  const at = stageEnteredAt(app)
  if (!at) return null
  const t = new Date(at).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / DAY_MS))
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export type NextActionTone = "due" | "warn" | "neutral"
export type NextAction = { label: string; tone: NextActionTone; icon: NextActionIcon }
export type NextActionIcon = "calendar" | "bell" | "hourglass"

/**
 * The single most relevant upcoming action for a card. Priority:
 *   1. soonest scheduled interview (future-dated)
 *   2. follow-up date (overdue → due, ≤3d → warn)
 *   3. offer decision deadline (offer status only)
 */
export function nextAction(app: JobApplication, now: number = Date.now()): NextAction | null {
  const today = startOfDay(now)

  const upcoming = (app.interviews ?? [])
    .filter((r) => r.date && startOfDay(new Date(r.date).getTime()) >= today)
    .sort((a, b) => +new Date(a.date!) - +new Date(b.date!))[0]
  if (upcoming?.date) {
    const days = Math.round((startOfDay(new Date(upcoming.date).getTime()) - today) / DAY_MS)
    return { label: `Interview · ${shortDate(upcoming.date)}`, tone: days <= 3 ? "warn" : "neutral", icon: "calendar" }
  }

  if (app.follow_up_date) {
    const days = Math.round((startOfDay(new Date(app.follow_up_date).getTime()) - today) / DAY_MS)
    if (days < 0) return { label: "Follow up · overdue", tone: "due", icon: "bell" }
    if (days === 0) return { label: "Follow up · today", tone: "warn", icon: "bell" }
    return { label: `Follow up · ${days}d`, tone: days <= 3 ? "warn" : "neutral", icon: "bell" }
  }

  const deadline = app.offer_details?.offer_deadline
  if (app.status === "offer" && deadline) {
    const days = Math.round((startOfDay(new Date(deadline).getTime()) - today) / DAY_MS)
    if (days < 0) return { label: "Decision · overdue", tone: "due", icon: "hourglass" }
    return { label: `Decide · ${days}d`, tone: days <= 3 ? "warn" : "neutral", icon: "hourglass" }
  }

  return null
}

const GENERIC_SOURCES = new Set(["", "manual", "web", "import", "extension", "unknown"])

/** Up to two lightweight tags derived from existing fields. */
export function deriveTags(app: JobApplication): string[] {
  const tags: string[] = []
  const src = (app.source ?? "").toLowerCase()
  if (/referr/.test(src)) tags.push("Referral")
  else if (src && !GENERIC_SOURCES.has(src)) tags.push(app.source!.replace(/[-_]/g, " "))
  return tags.slice(0, 2)
}
