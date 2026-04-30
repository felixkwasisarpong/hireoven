/**
 * Daily mission localStorage cache.
 *
 * Missions are generated once per calendar day and cached.
 * Stale entries (from a previous day) are automatically cleared.
 * Individual mission status (dismissed, completed) is persisted.
 */

import type { ScoutMission, ScoutMissionStatus, ScoutMissionStore } from "./types"

const KEY = "hireoven:scout-missions:v1"

function todayStr(): string {
  return new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
}

export function readMissionStore(): ScoutMissionStore | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const store = JSON.parse(raw) as ScoutMissionStore
    // Stale if generated on a previous day
    if (store.date !== todayStr()) return null
    return store
  } catch { return null }
}

export function writeMissionStore(store: ScoutMissionStore): void {
  if (typeof window === "undefined") return
  try { localStorage.setItem(KEY, JSON.stringify({ ...store, date: todayStr() })) } catch {}
}

export function clearMissionStore(): void {
  if (typeof window === "undefined") return
  try { localStorage.removeItem(KEY) } catch {}
}

export function patchMissionStatus(
  store: ScoutMissionStore,
  missionId: string,
  status: ScoutMissionStatus,
): ScoutMissionStore {
  const updated: ScoutMissionStore = {
    ...store,
    missions: store.missions.map((m) =>
      m.id === missionId ? { ...m, status } : m
    ),
  }
  writeMissionStore(updated)
  return updated
}

export function setMissionsDisabled(disabled: boolean): void {
  const store = readMissionStore()
  if (!store) return
  writeMissionStore({ ...store, disabled })
}

/** Returns missions that are still actionable (pending or in_progress only). */
export function activeMissions(missions: ScoutMission[]): ScoutMission[] {
  return missions.filter((m) => m.status === "pending" || m.status === "in_progress")
}
