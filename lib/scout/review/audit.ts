/**
 * Review audit log — sessionStorage only.
 *
 * Records review lifecycle events locally.
 * Never stores field values, resume content, or PII.
 */

import type { ReviewAuditEntry, ReviewAuditEvent, SubmitReadiness } from "./types"

const AUDIT_KEY = "hireoven:review-audit-log:v1"
const MAX_ENTRIES = 100

function makeId(): string {
  return `ra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function logReviewEvent(entry: Omit<ReviewAuditEntry, "id" | "timestamp">): void {
  if (typeof window === "undefined") return
  try {
    const raw = sessionStorage.getItem(AUDIT_KEY)
    const log: ReviewAuditEntry[] = raw ? (JSON.parse(raw) as ReviewAuditEntry[]) : []
    log.unshift({ ...entry, id: makeId(), timestamp: Date.now() })
    sessionStorage.setItem(AUDIT_KEY, JSON.stringify(log.slice(0, MAX_ENTRIES)))
  } catch {}
}

export function readReviewAuditLog(): ReviewAuditEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = sessionStorage.getItem(AUDIT_KEY)
    return raw ? (JSON.parse(raw) as ReviewAuditEntry[]) : []
  } catch { return [] }
}

export function clearReviewAuditLog(): void {
  if (typeof window === "undefined") return
  try { sessionStorage.removeItem(AUDIT_KEY) } catch {}
}
