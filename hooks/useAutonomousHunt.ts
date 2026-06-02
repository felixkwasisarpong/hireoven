"use client"

import { useCallback, useRef, useState } from "react"
import type { ApexAutonomousHuntPlan } from "@/lib/apex/hunt/types"

export type AutonomousHuntState = {
  data: ApexAutonomousHuntPlan | null
  loading: boolean
  error: string | null
}

export type AutonomousHuntActions = AutonomousHuntState & {
  generate: (message?: string) => Promise<void>
  refresh: () => Promise<void>
  reset: () => void
}

const DEFAULT_MESSAGE = "Run autonomous hunt for today"
const INITIAL: AutonomousHuntState = { data: null, loading: false, error: null }

export function useAutonomousHunt(): AutonomousHuntActions {
  const [state, setState] = useState<AutonomousHuntState>(INITIAL)
  const lastMessageRef = useRef<string>(DEFAULT_MESSAGE)

  const generate = useCallback(async (message?: string) => {
    const nextMessage = message?.trim() || lastMessageRef.current || DEFAULT_MESSAGE
    lastMessageRef.current = nextMessage
    setState((prev) => ({ data: prev.data, loading: true, error: null }))

    try {
      const res = await fetch("/api/apex/hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: nextMessage }),
      })

      const payload = await res.json().catch(() => null) as { plan?: ApexAutonomousHuntPlan; error?: string } | null

      if (!res.ok || !payload?.plan) {
        setState((prev) => ({
          data: prev.data,
          loading: false,
          error: payload?.error ?? "Autonomous Hunt could not prepare a plan right now.",
        }))
        return
      }

      setState({ data: payload.plan, loading: false, error: null })
    } catch {
      setState((prev) => ({
        data: prev.data,
        loading: false,
        error: "Network error. Please try again.",
      }))
    }
  }, [])

  const refresh = useCallback(async () => generate(lastMessageRef.current || DEFAULT_MESSAGE), [generate])
  const reset = useCallback(() => setState(INITIAL), [])

  return { ...state, generate, refresh, reset }
}
