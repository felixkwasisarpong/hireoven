"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { GitBranch, ArrowRight, Plane, X } from "lucide-react"
import type { PivotSuggestion } from "@/lib/resume/pivot-suggest"

/**
 * Inline feed card that surfaces the user's single best career pivot — computed
 * from their resume's real field signal against the live-corpus demand +
 * sponsorship profiles (see lib/resume/pivot-suggest.ts). It only appears when
 * there's a concrete, reachable upside: an adjacent field with meaningfully more
 * openings and/or a real visa edge that the resume is already partway into.
 *
 * Honest by construction — every number is corpus-grounded, the bridge skills
 * are the target field's in-demand skills the resume actually lacks, and the CTA
 * deep-links to the full, evidence-backed pivot plan. Dismissible per-suggestion.
 */

const DISMISS_PREFIX = "pivot-nudge-dismissed:"

function fmt(n: number): string {
  return n.toLocaleString("en-US")
}

export default function FeedPivotNudge() {
  const [pivot, setPivot] = useState<PivotSuggestion | null>(null)
  const [dismissed, setDismissed] = useState(true) // assume dismissed until we know

  useEffect(() => {
    let alive = true
    fetch("/api/resume/bridge")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { suggestedTo?: PivotSuggestion | null } | null) => {
        if (!alive) return
        const s = data?.suggestedTo ?? null
        setPivot(s)
        if (s) {
          const key = DISMISS_PREFIX + s.toKey
          setDismissed(window.localStorage.getItem(key) === "1")
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!pivot || dismissed) return null

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_PREFIX + pivot.toKey, "1")
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  const showMultiple = pivot.jobMultiple >= 1.3 && pivot.currentJobCount > 0
  const showSponsor = pivot.sponsorDelta >= 8 && typeof pivot.targetSponsorship === "number"
  const bridge = pivot.bridgeSkills.slice(0, 3)

  return (
    <div className="relative overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-violet-50 to-emerald-50 px-4 py-3">
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss pivot suggestion"
        className="absolute right-2 top-2 rounded-md p-1 text-slate-400 transition hover:bg-white/60 hover:text-slate-600"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>

      <div className="flex items-start gap-3 pr-6">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-600">
          <GitBranch className="h-4 w-4" aria-hidden />
        </span>

        <div className="min-w-0 space-y-1.5">
          <p className="text-[13px] leading-snug text-slate-700">
            You read strongest as{" "}
            <span className="font-semibold text-slate-900">{pivot.fromLabel}</span>, but{" "}
            <span className="font-semibold text-indigo-700">{pivot.toLabel}</span> is right next door —{" "}
            <span className="font-semibold text-slate-900">{fmt(pivot.targetJobCount)} live US openings</span>
            {showMultiple && (
              <>
                {" "}
                <span className="text-slate-500">({pivot.jobMultiple}× your current field)</span>
              </>
            )}
            {showSponsor && (
              <>
                {", "}
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <Plane className="h-3.5 w-3.5" aria-hidden />
                  {Math.round((pivot.targetSponsorship as number) * 100)}% sponsor visas
                </span>{" "}
                <span className="text-emerald-600">(+{pivot.sponsorDelta} pts)</span>
              </>
            )}
            . You&rsquo;re already{" "}
            <span className="font-semibold text-slate-900">{pivot.currentFit}% of the way there</span>.
          </p>

          {bridge.length > 0 && (
            <p className="flex flex-wrap items-center gap-1.5 text-[12px] text-slate-600">
              <span className="text-slate-500">Cross over by adding:</span>
              {bridge.map((skill) => (
                <span
                  key={skill}
                  className="rounded-md bg-white/70 px-1.5 py-0.5 font-medium text-slate-700 ring-1 ring-inset ring-indigo-100"
                >
                  {skill}
                </span>
              ))}
            </p>
          )}

          <Link
            href={`/dashboard/pivot?to=${encodeURIComponent(pivot.toKey)}`}
            className="inline-flex items-center gap-1.5 pt-0.5 text-[12.5px] font-semibold text-indigo-700 transition hover:text-indigo-900"
          >
            See your {pivot.toLabel} pivot plan
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  )
}
