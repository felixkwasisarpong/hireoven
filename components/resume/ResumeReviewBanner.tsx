"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2, Stethoscope } from "lucide-react"

type Summary = {
  hasResume: boolean
  readsAs?: string | null
  verdict?: string
  blockers?: number
  majors?: number
  steps?: Array<{ id: string; title: string; severity: string }>
}

/**
 * Overview entry point for the resume review.
 *
 * Hits the deterministic half of /api/resume/review only (no ?narrate=1), so it
 * costs nothing and paints fast. It deliberately shows the real counts and the
 * lead finding rather than a generic "Analyze my resume" button — a user who can
 * already see that two things are ending their applications has a reason to
 * click, and that visible specificity is the product.
 */
export default function ResumeReviewBanner() {
  const [data, setData] = useState<Summary | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/resume/review")
      .then((r) => (r.ok ? (r.json() as Promise<Summary>) : null))
      .then((d) => alive && d && setData(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  if (!data?.hasResume) return null

  const blockers = data.blockers ?? 0
  const majors = data.majors ?? 0
  const lead = data.steps?.[0]
  const clean = !lead

  return (
    <section
      className={`rounded-2xl border shadow-sm ${
        clean
          ? "border-emerald-200 bg-emerald-50/70"
          : blockers > 0
            ? "border-rose-200 bg-rose-50/70"
            : "border-amber-200 bg-amber-50/70"
      }`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              clean ? "bg-emerald-100 text-emerald-700" : blockers > 0 ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"
            }`}
          >
            {clean ? (
              <CheckCircle2 className="h-4.5 w-4.5" aria-hidden />
            ) : (
              <Stethoscope className="h-4.5 w-4.5" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-[14.5px] font-bold text-slate-900">
              {clean
                ? "Nothing structural is blocking your resume"
                : blockers > 0
                  ? `${blockers} thing${blockers === 1 ? "" : "s"} can end your applications before anyone reads a bullet`
                  : `${majors} issue${majors === 1 ? "" : "s"} are costing you reads`}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-slate-600">
              {clean
                ? "So your constraint is where you are sending it, not what it says."
                : `Starting with: ${lead?.title}.`}
            </p>
          </div>
        </div>

        <Link
          href="/dashboard/resume/review"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-slate-800"
        >
          {clean ? "See the review" : "Walk me through it"}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </section>
  )
}
