"use client"

import { useCallback, useState } from "react"
import { writeCareerStrategy } from "@/lib/scout/career/store"
import type { ScoutCareerStrategyResult } from "@/lib/scout/career/types"

export type CareerStrategyState = {
  data:    ScoutCareerStrategyResult | null
  loading: boolean
  error:   string | null
}

export type CareerStrategyActions = CareerStrategyState & {
  generate: (message: string) => Promise<void>
  reset:    () => void
}

const INITIAL: CareerStrategyState = { data: null, loading: false, error: null }

export function useCareerStrategy(): CareerStrategyActions {
  const [state, setState] = useState<CareerStrategyState>(INITIAL)

  const generate = useCallback(async (message: string) => {
    setState({ data: null, loading: true, error: null })
    try {
      const res = await fetch("/api/scout/career", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message }),
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => null) as { error?: string } | null
        setState({ data: null, loading: false, error: errJson?.error ?? "Career analysis failed." })
        return
      }

      const data = await res.json() as ScoutCareerStrategyResult
      writeCareerStrategy(data)
      setState({ data, loading: false, error: null })
    } catch {
      setState({ data: null, loading: false, error: "Network error. Please try again." })
    }
  }, [])

  const reset = useCallback(() => setState(INITIAL), [])

  return { ...state, generate, reset }
}
