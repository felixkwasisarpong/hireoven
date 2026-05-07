"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import InterviewTopBar from "@/components/interview/InterviewTopBar"
import MessageBubble from "@/components/interview/MessageBubble"
import MessageComposer from "@/components/interview/MessageComposer"
import SkillCoverageRail from "@/components/interview/SkillCoverageRail"
import { cn } from "@/lib/utils"

// ── Types ─────────────────────────────────────────────────────────────────────

type TurnData = {
  id: string
  role: "interviewer" | "candidate"
  content: string
  turnIndex: number
  skillTag?: string | null
}

type SessionData = {
  id: string
  type: string
  persona: string
  questionSet: string
  status: string
  durationTargetMin: number
  jobId: string | null
  startedAt: string | null
  endedAt: string | null
  metadata?: { practice_focus?: { observation: string } | null }
}

type JobData = {
  title: string
  company: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeRemaining(startedAt: string | null, durationMin: number): number {
  if (!startedAt) return durationMin * 60
  const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  return Math.max(0, durationMin * 60 - elapsed)
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TextInterviewChat({ sessionId }: { sessionId: string }) {
  const router = useRouter()

  const [session, setSession] = useState<SessionData | null>(null)
  const [job, setJob] = useState<JobData | null>(null)
  const [turns, setTurns] = useState<TurnData[]>([])
  const [skillList, setSkillList] = useState<string[]>([])
  const [skillsCovered, setSkillsCovered] = useState<string[]>([])
  const [sessionStatus, setSessionStatus] = useState("setup")
  const [isLoading, setIsLoading] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [remainingSec, setRemainingSec] = useState(0)

  const chatEndRef = useRef<HTMLDivElement>(null)
  const autoEndFiredRef = useRef(false)

  // ── Scroll ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [turns, isLoading])

  // ── Timer ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session?.startedAt || sessionStatus === "completed" || sessionStatus === "abandoned") return

    const tick = () => {
      setRemainingSec(computeRemaining(session.startedAt, session.durationTargetMin))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [session?.startedAt, session?.durationTargetMin, sessionStatus])

  // Auto-end when timer hits 0
  useEffect(() => {
    if (remainingSec === 0 && sessionStatus === "active" && !isLoading && !autoEndFiredRef.current) {
      autoEndFiredRef.current = true
      void handleAutoEnd()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingSec, sessionStatus, isLoading])

  // ── Fetch initial state ───────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/interview/sessions/${sessionId}/turns`)
        const data = await res.json()
        if (!res.ok) { setIsInitializing(false); return }

        const s: SessionData = data.session
        setSession(s)
        setSessionStatus(s.status)
        setSkillList(data.skillList ?? [])
        setSkillsCovered(data.skillsCovered ?? [])
        setRemainingSec(computeRemaining(s.startedAt, s.durationTargetMin))

        // Map visible turns
        const visibleTurns: TurnData[] = (data.turns ?? []).map((t: Record<string, unknown>) => ({
          id: t.id as string,
          role: t.role as "interviewer" | "candidate",
          content: t.content as string,
          turnIndex: t.turnIndex as number,
          skillTag: ((t.metadata as Record<string, unknown>)?.skill_tag as string) ?? null,
        }))
        setTurns(visibleTurns)

        // Fetch session metadata (practice_focus etc.) from session endpoint
        try {
          const sessRes = await fetch(`/api/interview/sessions/${sessionId}`)
          if (sessRes.ok) {
            const sessData = await sessRes.json()
            if (sessData.session?.metadata) {
              setSession((prev) => prev ? { ...prev, metadata: sessData.session.metadata } : prev)
            }
          }
        } catch { /* non-critical */ }

        // If session has a job, fetch job metadata
        if (s.jobId) {
          const jobRes = await fetch(`/api/interview/sessions/${sessionId}`)
          const jobData = await jobRes.json()
          if (jobData.session?.jobTitle) {
            setJob({ title: jobData.session.jobTitle, company: jobData.session.jobCompany })
          }
        }

        // If no turns yet and session is not completed, open the interview
        if (visibleTurns.length === 0 && s.status !== "completed" && s.status !== "abandoned") {
          await sendTurn("BEGIN_INTERVIEW", s)
        }
      } finally {
        setIsInitializing(false)
      }
    }
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // ── Send a turn ────────────────────────────────────────────────────────────
  const sendTurn = useCallback(
    async (content: string, sessionOverride?: SessionData) => {
      const currentSession = sessionOverride ?? session
      if (!currentSession) return
      setSendError(null)
      setIsLoading(true)

      // Optimistically add candidate message (skip for BEGIN_INTERVIEW)
      const isBeginInterview = content === "BEGIN_INTERVIEW"
      const optimisticId = `opt-${Date.now()}`
      if (!isBeginInterview) {
        setTurns((prev) => [
          ...prev,
          {
            id: optimisticId,
            role: "candidate",
            content,
            turnIndex: -1,
          },
        ])
      }

      try {
        const res = await fetch(`/api/interview/sessions/${sessionId}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        })
        const data = await res.json()

        if (!res.ok) {
          setSendError(data.error ?? "Couldn't send. Retry?")
          if (!isBeginInterview) {
            setTurns((prev) => prev.filter((t) => t.id !== optimisticId))
          }
          return
        }

        // Replace optimistic with confirmed (for non-BEGIN_INTERVIEW)
        // and append interviewer turn
        setTurns((prev) => {
          const withoutOpt = isBeginInterview
            ? prev
            : prev.map((t) =>
                t.id === optimisticId
                  ? { ...t, id: `candidate-${Date.now()}` }
                  : t
              )
          return [
            ...withoutOpt,
            {
              id: data.turn.id,
              role: "interviewer" as const,
              content: data.turn.content,
              turnIndex: data.turn.turn_index,
              skillTag: data.turn.skill_tag,
            },
          ]
        })

        // Update skills covered
        if (data.skillsCovered) setSkillsCovered(data.skillsCovered)

        // Session status
        if (data.sessionStatus === "completed") {
          setSessionStatus("completed")
          // Auto-redirect to debrief after 2s
          setTimeout(() => {
            router.push(`/dashboard/interview/${sessionId}/debrief`)
          }, 2000)
        } else {
          setSessionStatus("active")
        }
      } catch {
        setSendError("Network error — couldn't send. Retry?")
        if (!isBeginInterview) {
          setTurns((prev) => prev.filter((t) => t.id !== optimisticId))
        }
      } finally {
        setIsLoading(false)
      }
    },
    [session, sessionId, router]
  )

  // ── End interview ──────────────────────────────────────────────────────────
  async function handleEndInterview() {
    setShowEndConfirm(false)
    setIsLoading(true)
    try {
      const res = await fetch(`/api/interview/sessions/${sessionId}/end`, { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        setSessionStatus("completed")
        router.push(data.debriefUrl)
      }
    } finally {
      setIsLoading(false)
    }
  }

  async function handleAutoEnd() {
    try {
      const res = await fetch(`/api/interview/sessions/${sessionId}/end`, { method: "POST" })
      const data = await res.json()
      if (res.ok) {
        setSessionStatus("completed")
        router.push(data.debriefUrl)
      }
    } catch { /* ignore */ }
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isInitializing) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="space-y-3 w-64">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    )
  }

  const isEnded = sessionStatus === "completed" || sessionStatus === "abandoned"

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      {session && (
        <InterviewTopBar
          persona={session.persona}
          jobTitle={job?.title ?? "Generic interview"}
          jobCompany={job?.company ?? null}
          remainingSec={remainingSec}
          onEndInterview={() => setShowEndConfirm(true)}
          sessionStatus={sessionStatus}
          practiceFocus={session.metadata?.practice_focus?.observation ?? null}
        />
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Chat thread */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-2xl space-y-3">
              {turns.map((turn) => (
                <MessageBubble key={turn.id} role={turn.role} content={turn.content} />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={chatEndRef} />
            </div>
          </div>

          {/* Completed banner */}
          {isEnded && (
            <div className="border-t border-emerald-100 bg-emerald-50 px-4 py-3 text-center">
              <p className="text-[13px] font-semibold text-emerald-700">
                Interview complete.{" "}
                <Link
                  href={`/dashboard/interview/${sessionId}/debrief`}
                  className="underline hover:text-emerald-800"
                >
                  View debrief →
                </Link>
              </p>
            </div>
          )}

          {/* Error */}
          {sendError && (
            <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-center">
              <span className="text-[12px] text-red-600">{sendError}</span>
              <button
                type="button"
                onClick={() => setSendError(null)}
                className="ml-2 text-[12px] font-medium text-red-700 underline"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Composer */}
          {!isEnded && (
            <div className="border-t border-slate-200 px-4 py-3 sm:px-6">
              <div className="mx-auto max-w-2xl">
                <MessageComposer
                  onSend={(content) => void sendTurn(content)}
                  disabled={isLoading}
                />
              </div>
            </div>
          )}
        </div>

        {/* Skill coverage rail */}
        <div className="hidden w-52 shrink-0 overflow-y-auto border-l border-slate-100 bg-slate-50 px-3 py-4 xl:block">
          <SkillCoverageRail skillList={skillList} skillsCovered={skillsCovered} />
        </div>
      </div>

      {/* End confirm dialog */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-[15px] font-semibold text-slate-900">End the interview now?</h3>
            <p className="mt-1.5 text-[13px] text-slate-500">
              You&apos;ll get a debrief based on the answers so far.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowEndConfirm(false)}
                className={cn(
                  "flex-1 rounded-lg border border-slate-200 py-2.5 text-[13px] font-medium text-slate-700",
                  "hover:bg-slate-50"
                )}
              >
                Keep going
              </button>
              <button
                type="button"
                onClick={() => void handleEndInterview()}
                className="flex-1 rounded-lg bg-orange-500 py-2.5 text-[13px] font-semibold text-white hover:bg-orange-600"
              >
                End &amp; get debrief
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
