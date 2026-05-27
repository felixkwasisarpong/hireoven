"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import DebriefHero from "@/components/interview/DebriefHero"
import DebriefStrengths from "@/components/interview/DebriefStrengths"
import DebriefGaps from "@/components/interview/DebriefGaps"
import DebriefBetterAnswers from "@/components/interview/DebriefBetterAnswers"
import DebriefCodingPanel from "@/components/interview/DebriefCodingPanel"
import DebriefNextSteps from "@/components/interview/DebriefNextSteps"
import GeneratingDebriefState from "@/components/interview/GeneratingDebriefState"

type DebriefData = Record<string, unknown>
type SessionData = Record<string, unknown>

export default function SharedDebriefPage() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [debrief, setDebrief] = useState<DebriefData | null>(null)
  const [session, setSession] = useState<SessionData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/interview/shared/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return }
        setDebrief(d.debrief)
        setSession(d.session)
      })
      .catch(() => setError("Failed to load debrief"))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <div className="mx-auto max-w-2xl px-4 py-8"><GeneratingDebriefState /></div>

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-[15px] font-semibold text-slate-900">{error}</p>
          <p className="mt-2 text-[13px] text-slate-500">This link may have expired or been revoked.</p>
          <Link href="/" className="mt-4 inline-block text-[13px] text-orange-500 hover:text-orange-600">← hireoven.com</Link>
        </div>
      </div>
    )
  }

  const d = debrief!
  const s = session!

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Minimal header */}
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <p className="text-[13px] font-semibold text-slate-700">Interview debrief · shared via hireoven</p>
          <Link href="https://hireoven.com" className="text-[12px] text-slate-400 hover:text-slate-600">hireoven.com</Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
        {d.overallScore != null && (
          <DebriefHero
            score={d.overallScore as number}
            headline={d.headline as string}
            type={s.type as string}
            persona={s.persona as string}
            jobTitle={s.jobTitle as string}
            jobCompany={null}
            sessionDate={s.sessionDate as string}
            durationMin={s.durationTargetMin as number}
          />
        )}

        <DebriefStrengths strengths={(d.strengths ?? []) as Array<{ observation: string; quote: string }>} />
        <DebriefGaps gaps={(d.gaps ?? []) as Array<{ observation: string; suggestion: string; quote: string }>} sessionType={s.type as string} jobId={null} />
        <DebriefBetterAnswers answers={(d.sampleBetterAnswers ?? []) as Array<{ question: string; your_answer: string; stronger_answer: string }>} />

        {s.type === "coding" && Boolean(d.codingFeedback) && (
          <DebriefCodingPanel
            feedback={d.codingFeedback as any}
            sessionId=""
            snapshotCount={0}
          />
        )}

        <DebriefNextSteps steps={(d.recommendedNext ?? []) as string[]} />
      </div>
    </div>
  )
}
