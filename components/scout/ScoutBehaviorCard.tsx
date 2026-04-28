"use client"

import { useEffect, useState } from "react"
import { Brain, X } from "lucide-react"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"

type Props = {
  signals: ScoutBehaviorSignals | null
  isLoading?: boolean
}

function deriveObservations(signals: ScoutBehaviorSignals): string[] {
  const obs: string[] = []

  if (signals.preferredRoles.length > 0) {
    const roles = signals.preferredRoles.slice(0, 2).join(" / ")
    obs.push(`You seem to prefer ${roles} roles`)
  } else if (signals.commonSkills.length > 0) {
    obs.push(`Your resume highlights: ${signals.commonSkills.slice(0, 3).join(", ")}`)
  }

  if (signals.sponsorshipSensitivity === "high") {
    obs.push("You often focus on sponsorship-friendly jobs")
  } else if (signals.sponsorshipSensitivity === "medium") {
    obs.push("Sponsorship availability looks relevant to your search")
  }

  if (signals.recentApplicationVelocity === "none") {
    obs.push("Your application pace is low this week")
  } else if (signals.recentApplicationVelocity === "low") {
    obs.push("You've been applying at a slow pace recently")
  } else if (signals.recentApplicationVelocity === "healthy") {
    obs.push("Your application pace looks healthy this week")
  }

  if (
    signals.savedJobPatterns.length > 0 &&
    signals.savedJobPatterns[0] === "sponsorship-friendly companies"
  ) {
    obs.push("Most of your watchlisted companies sponsor H-1B")
  }

  if (signals.avoidSignals.includes("jobs requiring work authorization")) {
    obs.push("Flagging jobs that require work authorization")
  }

  return obs.slice(0, 3)
}

/**
 * Displays lightweight "Scout noticed" personalization card derived from the
 * user's existing activity signals. Dismissible per session; re-shows on context reset.
 */
export function ScoutBehaviorCard({ signals, isLoading }: Props) {
  const [dismissed, setDismissed] = useState(false)

  // Re-show when the user resets Scout context
  useEffect(() => {
    function onReset() {
      setDismissed(false)
    }
    window.addEventListener("scout:reset-context", onReset)
    return () => window.removeEventListener("scout:reset-context", onReset)
  }, [])

  if (dismissed || isLoading || !signals) return null

  const observations = deriveObservations(signals)
  if (observations.length === 0) return null

  return (
    <section className="rounded-[16px] border border-orange-200/60 bg-orange-50/50 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex-shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-orange-100">
            <Brain className="h-3.5 w-3.5 text-orange-600" />
          </div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-orange-700">
            Scout noticed
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="flex-shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md text-orange-400 transition hover:bg-orange-100 hover:text-orange-700"
          aria-label="Dismiss Scout noticed card"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ul className="mt-2.5 space-y-1.5 pl-9">
        {observations.map((obs, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-xs text-orange-800 leading-5"
          >
            <span className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-orange-400" />
            {obs}
          </li>
        ))}
      </ul>

      <p className="mt-2.5 pl-9 text-[10px] leading-4 text-orange-400/80">
        Based on your activity · Scout uses these as hints, not rules
      </p>
    </section>
  )
}
