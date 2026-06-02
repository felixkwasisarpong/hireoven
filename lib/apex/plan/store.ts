/**
 * Daily Today Plan state cache.
 *
 * Stores only lightweight interaction state for today's plan items:
 * done, deferred, or restored. The actual plan contents are still
 * derived live from Apex strategy + nudges.
 */

export type ApexTodayPlanItemStatus = "done" | "deferred"

export type ApexTodayPlanItemState = {
  status: ApexTodayPlanItemStatus
  updatedAt: string
}

export type ApexTodayPlanStore = {
  date: string
  items: Record<string, ApexTodayPlanItemState>
}

const KEY = "hireoven:apex-today-plan:v1"

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

export function readTodayPlanStore(): ApexTodayPlanStore | null {
  if (typeof window === "undefined") return null

  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const store = JSON.parse(raw) as ApexTodayPlanStore
    if (store.date !== todayStr()) return null
    return store
  } catch {
    return null
  }
}

export function readTodayPlanItemState(): Record<string, ApexTodayPlanItemState> {
  return readTodayPlanStore()?.items ?? {}
}

export function writeTodayPlanItemState(items: Record<string, ApexTodayPlanItemState>): void {
  if (typeof window === "undefined") return

  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        date: todayStr(),
        items,
      } satisfies ApexTodayPlanStore)
    )
  } catch {}
}

export function patchTodayPlanItemState(
  items: Record<string, ApexTodayPlanItemState>,
  itemId: string,
  status: ApexTodayPlanItemStatus | null
): Record<string, ApexTodayPlanItemState> {
  const next = { ...items }

  if (status === null) {
    delete next[itemId]
  } else {
    next[itemId] = {
      status,
      updatedAt: new Date().toISOString(),
    }
  }

  writeTodayPlanItemState(next)
  return next
}

export function clearTodayPlanStore(): void {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(KEY) } catch {}
}
