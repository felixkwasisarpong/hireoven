"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Stethoscope, Wrench, X } from "lucide-react"

type Step = {
  id: string
  title: string
  severity: "blocker" | "major" | "minor"
  evidence: string[]
  doThis: string
}

/**
 * "You came here to fix this."
 *
 * Studio opens with every section collapsed and no memory of why the user
 * arrived, so clicking a fix from the review used to drop the finding on the
 * floor — they landed in a generic editor and had to remember what they were
 * doing. This re-fetches the review, pulls out the one finding named in the URL,
 * and keeps it on screen with its evidence and its instruction while they work.
 *
 * Renders nothing when there is no `finding` param, so Studio opened normally is
 * unaffected.
 */
export default function StudioFindingBanner({ findingId }: { findingId: string | null }) {
  const [step, setStep] = useState<Step | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!findingId) return
    let alive = true
    // Deterministic half only — no ?narrate=1. This is a reminder, not a reread.
    fetch("/api/resume/review")
      .then((r) => (r.ok ? (r.json() as Promise<{ steps?: Step[] }>) : null))
      .then((d) => {
        if (!alive) return
        setStep(d?.steps?.find((s) => s.id === findingId) ?? null)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [findingId])

  if (!findingId || !step || dismissed) return null

  const tone =
    step.severity === "blocker"
      ? "border-rose-200 bg-rose-50/70"
      : step.severity === "major"
        ? "border-amber-200 bg-amber-50/70"
        : "border-slate-200 bg-slate-50"

  return (
    <div className={`mb-4 rounded-xl border p-4 ${tone}`}>
      <div className="flex items-start gap-3">
        <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-slate-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
            You came here to fix
          </p>
          <p className="mt-0.5 text-[14.5px] font-bold text-slate-900">{step.title}</p>

          {step.evidence.length > 0 && (
            <ul className="mt-2 space-y-1">
              {step.evidence.slice(0, 3).map((e) => (
                <li key={e} className="flex gap-2 text-[12.5px] leading-relaxed text-slate-700">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-2.5 flex gap-1.5 text-[13px] leading-relaxed text-slate-800">
            <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
            <span>{step.doThis}</span>
          </p>

          <Link
            href="/dashboard/resume/optimize"
            className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to the review
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-white/70 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  )
}
