"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { generateProactiveEvents, type ProactiveGeneratorInput } from "@/lib/scout/proactive/generator"
import {
  clearMutedProactiveTypes,
  dismissProactiveEvent,
  isProactiveEventSuppressed,
  muteProactiveType,
  readProactiveEvents,
  readProactiveSettings,
  readProactiveStore,
  setProactiveEnabled,
  snoozeProactiveEvent,
  unmuteProactiveType,
  upsertProactiveEvents,
} from "@/lib/scout/proactive/store"
import type {
  ScoutProactiveEvent,
  ScoutProactiveEventType,
  ScoutProactiveSettings,
  ScoutProactiveSnapshot,
} from "@/lib/scout/proactive/types"

type UseScoutProactiveInput = Omit<ProactiveGeneratorInput, "snapshot"> & {
  /** Poll cadence for snapshot refresh. */
  refreshMs?: number
  /** Debounce write-back to avoid noisy localStorage churn. */
  debounceMs?: number
}

const TYPE_COOLDOWN_MS: Record<ScoutProactiveEventType, number> = {
  new_match: 2 * 60 * 60 * 1000,
  market_shift: 4 * 60 * 60 * 1000,
  workflow_reminder: 60 * 60 * 1000,
  application_followup: 2 * 60 * 60 * 1000,
  skill_signal: 8 * 60 * 60 * 1000,
  sponsorship_signal: 4 * 60 * 60 * 1000,
  company_activity: 3 * 60 * 60 * 1000,
  interview_reminder: 60 * 60 * 1000,
  stale_saved_job: 4 * 60 * 60 * 1000,
  queue_ready: 30 * 60 * 1000,
}

const SEVERITY_WEIGHT: Record<ScoutProactiveEvent["severity"], number> = {
  urgent: 0,
  important: 1,
  info: 2,
}

function sortEvents(events: ScoutProactiveEvent[]): ScoutProactiveEvent[] {
  return [...events].sort((a, b) => {
    const aw = SEVERITY_WEIGHT[a.severity]
    const bw = SEVERITY_WEIGHT[b.severity]
    if (aw !== bw) return aw - bw
    const aMs = new Date(a.createdAt).getTime()
    const bMs = new Date(b.createdAt).getTime()
    return bMs - aMs
  })
}

export type ScoutProactiveActions = {
  loading: boolean
  snapshot: ScoutProactiveSnapshot | null
  events: ScoutProactiveEvent[]
  visibleEvents: ScoutProactiveEvent[]
  topEvent: ScoutProactiveEvent | null
  settings: ScoutProactiveSettings
  refresh: () => Promise<void>
  dismiss: (eventId: string) => void
  snooze: (eventId: string, snoozeMs?: number) => void
  muteType: (type: ScoutProactiveEventType) => void
  unmuteType: (type: ScoutProactiveEventType) => void
  clearMutedTypes: () => void
  setEnabled: (enabled: boolean) => void
}

export function useScoutProactive({
  marketSignals,
  outcomeLearning,
  searchProfile,
  behaviorSignals,
  activeWorkflow,
  bulkQueue,
  now,
  refreshMs = 10 * 60 * 1000,
  debounceMs = 300,
}: UseScoutProactiveInput): ScoutProactiveActions {
  const [loading, setLoading] = useState(false)
  const [snapshot, setSnapshot] = useState<ScoutProactiveSnapshot | null>(null)
  const [events, setEvents] = useState<ScoutProactiveEvent[]>(() => readProactiveEvents())
  const [settings, setSettings] = useState<ScoutProactiveSettings>(() => readProactiveSettings())

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch("/api/scout/proactive", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })
      const data = (await res.json().catch(() => ({}))) as { snapshot?: ScoutProactiveSnapshot }
      setSnapshot(data.snapshot ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const store = readProactiveStore()
    setEvents(store.events)
    setSettings(store.settings)
  }, [])

  useEffect(() => {
    if (!settings.enabled) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), refreshMs)
    return () => window.clearInterval(timer)
  }, [refresh, refreshMs, settings.enabled])

  const generated = useMemo(
    () =>
      generateProactiveEvents({
        snapshot,
        marketSignals,
        outcomeLearning,
        searchProfile,
        behaviorSignals,
        activeWorkflow,
        bulkQueue,
        now,
      }),
    [
      snapshot,
      marketSignals,
      outcomeLearning,
      searchProfile,
      behaviorSignals,
      activeWorkflow,
      bulkQueue,
      now,
    ]
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const existing = readProactiveStore()
      const nowMs = Date.now()

      const accepted: ScoutProactiveEvent[] = generated.filter((event) => {
        if (isProactiveEventSuppressed(event, existing.settings, nowMs)) return false

        const latestSameType = existing.events.find((e) => e.type === event.type)
        if (!latestSameType) return true
        if (latestSameType.id === event.id) return true

        const latestMs = new Date(latestSameType.createdAt).getTime()
        if (!Number.isFinite(latestMs)) return true
        return nowMs - latestMs >= (TYPE_COOLDOWN_MS[event.type] ?? 60 * 60 * 1000)
      })

      if (accepted.length === 0) return
      const next = upsertProactiveEvents(accepted)
      setEvents(sortEvents(next.events))
      setSettings(next.settings)
    }, debounceMs)

    return () => window.clearTimeout(timer)
  }, [debounceMs, generated])

  const dismiss = useCallback((eventId: string) => {
    const next = dismissProactiveEvent(eventId)
    setEvents(sortEvents(next.events))
    setSettings(next.settings)
  }, [])

  const snooze = useCallback((eventId: string, snoozeMs = 6 * 60 * 60 * 1000) => {
    const next = snoozeProactiveEvent(eventId, snoozeMs)
    setEvents(sortEvents(next.events))
    setSettings(next.settings)
  }, [])

  const muteType = useCallback((type: ScoutProactiveEventType) => {
    const next = muteProactiveType(type)
    setEvents(sortEvents(next.events))
    setSettings(next.settings)
  }, [])

  const unmuteType = useCallback((type: ScoutProactiveEventType) => {
    const next = unmuteProactiveType(type)
    setEvents(sortEvents(next.events))
    setSettings(next.settings)
  }, [])

  const clearMutedTypes = useCallback(() => {
    const next = clearMutedProactiveTypes()
    setEvents(sortEvents(next.events))
    setSettings(next.settings)
  }, [])

  const setEnabled = useCallback((enabled: boolean) => {
    const next = setProactiveEnabled(enabled)
    setEvents(sortEvents(next.events))
    setSettings(next.settings)
  }, [])

  const visibleEvents = useMemo(() => {
    const nowMs = Date.now()
    return sortEvents(events)
      .filter((event) => !isProactiveEventSuppressed(event, settings, nowMs))
      .slice(0, 4)
  }, [events, settings])

  return {
    loading,
    snapshot,
    events,
    visibleEvents,
    topEvent: visibleEvents[0] ?? null,
    settings,
    refresh,
    dismiss,
    snooze,
    muteType,
    unmuteType,
    clearMutedTypes,
    setEnabled,
  }
}
