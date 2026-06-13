"use client"

/**
 * Closed-loop resume A/B panel for the Applications insights page.
 * Shows which resume variant earns the most callbacks and lets the user promote
 * the winner to primary in one click. Degrades gracefully while data is thin.
 */
import { useEffect, useState } from "react"
import { CheckCircle2, Loader2, Star, Trophy } from "lucide-react"

type Variant = {
  resumeId: string
  resumeName: string
  applications: number
  responses: number
  responseRate: number
  enoughData: boolean
}
type Recommendation = { leaderId: string; leaderName: string; confident: boolean; headline: string }
type Data = {
  variants: Variant[]
  recommendation: Recommendation | null
  comparable: boolean
  attributed: number
  submitted: number
  primaryResumeId: string | null
}

export default function ResumePerformancePanel() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [promoting, setPromoting] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/applications/resume-performance", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d))
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [])

  async function promote(resumeId: string) {
    setPromoting(resumeId)
    try {
      const res = await fetch("/api/applications/resume-performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promoteResumeId: resumeId }),
      })
      if (res.ok) setData((d) => (d ? { ...d, primaryResumeId: resumeId } : d))
    } finally {
      setPromoting(null)
    }
  }

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-[18px] border border-slate-200/80 bg-white p-6 shadow-[0_1px_0_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.05)]">
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-slate-400">Which resume gets callbacks</p>
      {children}
    </div>
  )

  if (loading) {
    return (
      <Shell>
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-slate-100" />
      </Shell>
    )
  }
  if (!data || data.variants.length === 0) {
    return (
      <Shell>
        <p className="mt-2 text-[14px] leading-relaxed text-slate-500">
          Apply with your resumes and we&apos;ll track which variant earns the most callbacks — then recommend the
          winner.{" "}
          {data && data.submitted > 0 && (
            <span className="text-slate-400">
              {data.attributed} of {data.submitted} applications are linked to a resume so far; new ones are tracked
              automatically.
            </span>
          )}
        </p>
      </Shell>
    )
  }

  const max = Math.max(...data.variants.map((v) => v.responseRate), 0.001)

  return (
    <Shell>
      {data.recommendation?.confident && (
        <div className="mt-2 mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
          <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p className="text-[13.5px] font-medium leading-snug text-emerald-900">{data.recommendation.headline}</p>
        </div>
      )}
      {data.recommendation && !data.recommendation.confident && (
        <p className="mt-2 mb-4 text-[13px] leading-snug text-slate-500">{data.recommendation.headline}</p>
      )}

      <div className="space-y-3">
        {data.variants.map((v) => {
          const isPrimary = v.resumeId === data.primaryResumeId
          return (
            <div key={v.resumeId} className="rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-[14px] font-semibold text-slate-800">{v.resumeName}</p>
                  {isPrimary && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600">
                      <Star className="h-2.5 w-2.5" fill="currentColor" /> Primary
                    </span>
                  )}
                  {!v.enoughData && (
                    <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">small sample</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-[13px] font-bold tabular-nums text-slate-900">{Math.round(v.responseRate * 100)}%</span>
                  {!isPrimary && (
                    <button
                      type="button"
                      onClick={() => void promote(v.resumeId)}
                      disabled={promoting !== null}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-[12px] font-semibold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50"
                    >
                      {promoting === v.resumeId ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                      Make primary
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${(v.responseRate / max) * 100}%` }} />
              </div>
              <p className="mt-1.5 text-[11.5px] text-slate-400">
                {v.responses} of {v.applications} application{v.applications === 1 ? "" : "s"} got a callback
              </p>
            </div>
          )
        })}
      </div>

      {data.attributed < data.submitted && (
        <p className="mt-4 text-[11.5px] leading-relaxed text-slate-400">
          {data.attributed} of {data.submitted} applications are linked to a resume. Older ones applied before tracking
          aren&apos;t attributed; new applications are linked automatically.
        </p>
      )}
    </Shell>
  )
}
