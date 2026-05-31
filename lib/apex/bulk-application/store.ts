import type { BulkApplicationQueue } from "./types"

const KEY = "hireoven:scout-bulk-queue:v1"

export function readBulkQueue(): BulkApplicationQueue | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as BulkApplicationQueue) : null
  } catch { return null }
}

export function writeBulkQueue(queue: BulkApplicationQueue): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(KEY, JSON.stringify(queue)) } catch {}
}

export function clearBulkQueue(): void {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(KEY) } catch {}
}
