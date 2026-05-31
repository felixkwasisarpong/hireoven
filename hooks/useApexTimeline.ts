"use client"

import { useCallback, useEffect, useState } from "react"
import {
  readTimelineEvents,
  appendTimelineEvent,
  clearTimeline,
  makeTimelineId,
} from "@/lib/scout/timeline/store"
import { FILTER_EVENT_TYPES } from "@/lib/scout/timeline/types"
import type {
  ScoutTimelineEvent,
  ScoutTimelineEventType,
  TimelineFilter,
} from "@/lib/scout/timeline/types"

export type { ScoutTimelineEvent, TimelineFilter }

export type ScoutTimelineActions = {
  /** All events, newest-first */
  events:         ScoutTimelineEvent[]
  /** Append one event — safe to call on every render (uses stable refs). */
  append:         (event: Omit<ScoutTimelineEvent, "id">) => void
  /** Filter events by category. Returns newest-first slice (max 50). */
  filtered:       (filter: TimelineFilter) => ScoutTimelineEvent[]
  /** Clear entire timeline (e.g. on "Start fresh"). */
  clear:          () => void
  /** Util: generate a unique timeline event ID. */
  makeId:         () => string
}

export function useScoutTimeline(): ScoutTimelineActions {
  // Start with empty array on both server and client (avoids hydration mismatch).
  // localStorage is loaded after mount so the server-rendered HTML matches the
  // initial client render before React takes over.
  const [events, setEvents] = useState<ScoutTimelineEvent[]>([])

  useEffect(() => {
    const stored = readTimelineEvents()
    if (stored.length > 0) setEvents(stored)
  }, [])

  const append = useCallback((partial: Omit<ScoutTimelineEvent, "id">) => {
    const event: ScoutTimelineEvent = {
      id: makeTimelineId(),
      severity: "info",
      ...partial,
    }
    appendTimelineEvent(event)
    setEvents((prev) => [event, ...prev].slice(0, 240))
  }, [])

  const filtered = useCallback(
    (filter: TimelineFilter): ScoutTimelineEvent[] => {
      const allowedTypes = FILTER_EVENT_TYPES[filter]
      const src = allowedTypes.length === 0
        ? events
        : events.filter((e) => (allowedTypes as ScoutTimelineEventType[]).includes(e.type))
      return src.slice(0, 50)
    },
    [events]
  )

  const clear = useCallback(() => {
    clearTimeline()
    setEvents([])
  }, [])

  return { events, append, filtered, clear, makeId: makeTimelineId }
}
