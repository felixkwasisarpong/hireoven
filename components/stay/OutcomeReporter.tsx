"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { submitStayOutcome } from "@/app/(public)/stay/actions"
import {
  OUTCOME_LABEL,
  OUTCOME_TONE,
  STAY_OUTCOMES,
  type OutcomeSummary,
  type StayOutcome,
} from "@/lib/stay/outcome-types"

const TONE_COLOR = { good: "#38e08a", crit: "#e5695f", neutral: "#6c7a72" } as const

function getVisitorId(): string | undefined {
  try {
    const KEY = "ho_visitor_id"
    let id = localStorage.getItem(KEY)
    if (!id) {
      id = (crypto?.randomUUID?.() ?? String(Math.random()).slice(2)) + ""
      localStorage.setItem(KEY, id)
    }
    return id
  } catch {
    return undefined
  }
}

/** Community outcome flywheel: report what actually happened at an employer, and
 *  see the aggregate. Renders on the job detail Stay panel. Degrades to a quiet
 *  state if the backing table isn't migrated yet. */
export default function OutcomeReporter({
  companyId,
  employerName,
  wageLevel,
  initialSummary = null,
}: {
  companyId?: string | null
  employerName: string
  wageLevel?: number | null
  initialSummary?: OutcomeSummary | null
}) {
  const [summary, setSummary] = useState<OutcomeSummary | null>(initialSummary)
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<StayOutcome | null>(null)
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle")
  const [pending, startTransition] = useTransition()
  const [visitorId, setVisitorId] = useState<string | undefined>(undefined)

  useEffect(() => setVisitorId(getVisitorId()), [])

  const tally = useMemo(() => {
    if (!summary || summary.total === 0) return []
    return STAY_OUTCOMES.map((o) => ({ outcome: o, n: summary.counts[o] })).filter((x) => x.n > 0)
  }, [summary])

  const submit = (outcome: StayOutcome) => {
    setChoice(outcome)
    startTransition(async () => {
      const res = await submitStayOutcome({
        companyId,
        employerName,
        outcome,
        wageLevel,
        isStem: true,
        visitorId,
      })
      if (res.ok) {
        setStatus("done")
        if (res.summary) setSummary(res.summary)
        setOpen(false)
      } else {
        setStatus("error")
      }
    })
  }

  return (
    <div className="mt-3 border border-[rgba(120,200,160,0.2)] bg-[#0a0e0c] p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="term-label">&gt; community_outcomes</p>
        {summary && summary.total > 0 && (
          <span className="text-[11px] text-[#6c7a72]">{summary.total} reported</span>
        )}
      </div>

      {tally.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {tally.map(({ outcome, n }) => (
            <div key={outcome} className="flex items-center justify-between text-[12.5px]">
              <span style={{ color: TONE_COLOR[OUTCOME_TONE[outcome]] }}>{OUTCOME_LABEL[outcome]}</span>
              <span className="tabular-nums text-[#ccd6cf]/60">{n}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-[#ccd6cf]/55">No reports yet — be the first to help the next applicant.</p>
      )}

      {status === "done" ? (
        <p className="mt-3 text-[12.5px] text-[#38e08a]">Thanks — your report sharpens the score for everyone.</p>
      ) : open ? (
        <div className="mt-3">
          <p className="mb-2 text-[12px] text-[#ccd6cf]/60">What happened at {employerName}?</p>
          <div className="flex flex-wrap gap-2">
            {STAY_OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                disabled={pending}
                onClick={() => submit(o)}
                className="border border-[rgba(120,200,160,0.2)] bg-[#0e1411] px-2.5 py-1.5 text-[12px] text-[#ccd6cf]/80 transition hover:border-[#38e08a] hover:text-[#38e08a] disabled:opacity-60"
              >
                {pending && choice === o ? "…" : OUTCOME_LABEL[o]}
              </button>
            ))}
          </div>
          {status === "error" && (
            <p className="mt-2 text-[12px] text-[#f5a623]">Couldn&apos;t record that right now — try again shortly.</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-[12px] font-semibold text-[#f5a623] underline decoration-[#f5a623]/40 underline-offset-4 hover:decoration-[#f5a623]"
        >
          Report your outcome →
        </button>
      )}
    </div>
  )
}
