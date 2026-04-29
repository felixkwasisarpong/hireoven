"use client"

import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Lock,
  MessageSquare,
  Mic2,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import type { ScoutMockInterviewFeedback, ScoutMockInterviewTurn } from "@/lib/scout/types"

// ── Types ─────────────────────────────────────────────────────────────────────

type MockInterviewProps = {
  jobId?: string
  resumeId?: string
  jobTitle?: string
  companyName?: string
}

type SessionState = {
  sessionId: string
  history: ScoutMockInterviewTurn[]
  currentQuestion: string | null
  questionIndex: number
  totalQuestions: number
  isComplete: boolean
  pendingFeedback: ScoutMockInterviewFeedback | null
}

type APIResponse = {
  question?: string | null
  feedback?: ScoutMockInterviewFeedback | null
  questionIndex?: number
  totalQuestions?: number
  isComplete?: boolean
  gated?: boolean
  feature?: string
  upgradeMessage?: string
  error?: string
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FeedbackCard({ feedback }: { feedback: ScoutMockInterviewFeedback }) {
  const [showSuggested, setShowSuggested] = useState(false)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
        Scout Feedback
      </p>

      {feedback.strengths.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-emerald-700">Strengths</p>
          <ul className="mt-1.5 space-y-1.5">
            {feedback.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.improvements.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-amber-700">Areas to improve</p>
          <ul className="mt-1.5 space-y-1.5">
            {feedback.improvements.map((imp, i) => (
              <li key={i} className="flex items-start gap-2 text-sm leading-6 text-slate-700">
                <ArrowRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                {imp}
              </li>
            ))}
          </ul>
        </div>
      )}

      {feedback.suggestedAnswer && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowSuggested((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-orange-700 hover:underline"
          >
            {showSuggested ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showSuggested ? "Hide" : "Show"} suggested answer
          </button>
          {showSuggested && (
            <div className="mt-2 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
              <p className="text-sm leading-6 text-orange-900">{feedback.suggestedAnswer}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GateCard({ upgradeMessage, onUpgrade }: { upgradeMessage: string; onUpgrade: () => void }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex items-start gap-3">
        <div className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100">
          <Lock className="h-4 w-4 text-amber-700" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">Continue with Pro</p>
          <p className="mt-1 text-xs leading-5 text-amber-800">{upgradeMessage}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onUpgrade}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-700"
      >
        <Sparkles className="h-4 w-4" />
        Upgrade to unlock full interview
      </button>
    </div>
  )
}

function ProgressBar({
  current,
  total,
}: {
  current: number
  total: number
}) {
  const pct = Math.round(((current - 1) / total) * 100)
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-1.5">
        <div
          className="h-full rounded-full bg-orange-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="flex-shrink-0 text-[11px] font-semibold text-slate-400">
        {current - 1}/{total}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ScoutMockInterview({
  jobId,
  resumeId,
  jobTitle,
  companyName,
}: MockInterviewProps) {
  const { showUpgrade } = useUpgradeModal()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [gateMessage, setGateMessage] = useState<string | null>(null)
  const [answer, setAnswer] = useState("")

  const [session, setSession] = useState<SessionState | null>(null)

  const roleLabel = jobTitle
    ? `${jobTitle}${companyName ? ` at ${companyName}` : ""}`
    : "this role"

  // ── API call ──────────────────────────────────────────────────────────────

  const callAPI = useCallback(
    async (params: {
      history: ScoutMockInterviewTurn[]
      currentAnswer?: string
      questionIndex: number
      sessionId: string
    }) => {
      setIsLoading(true)
      setApiError(null)

      try {
        const res = await fetch("/api/scout/mock-interview", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            resumeId,
            sessionId: params.sessionId,
            history: params.history,
            currentAnswer: params.currentAnswer,
            questionIndex: params.questionIndex,
          }),
        })

        const data = (await res.json().catch(() => null)) as APIResponse | null

        if (!res.ok || !data) {
          setApiError(data?.error ?? "Scout couldn't generate a question right now. Try again.")
          return null
        }

        if (data.gated) {
          setGateMessage(
            data.upgradeMessage ??
              "Upgrade to Pro to continue the mock interview."
          )
          return null
        }

        return data
      } catch {
        setApiError("Network error. Please check your connection and try again.")
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [jobId, resumeId]
  )

  // ── Start session ─────────────────────────────────────────────────────────

  async function startSession() {
    const sessionId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    setGateMessage(null)
    setApiError(null)
    setAnswer("")

    const data = await callAPI({ history: [], questionIndex: 1, sessionId })
    if (!data) return

    setSession({
      sessionId,
      history: [],
      currentQuestion: data.question ?? null,
      questionIndex: data.questionIndex ?? 1,
      totalQuestions: data.totalQuestions ?? 6,
      isComplete: data.isComplete ?? false,
      pendingFeedback: null,
    })
  }

  // ── Submit answer ─────────────────────────────────────────────────────────

  async function submitAnswer() {
    if (!session || !answer.trim() || isLoading) return

    const trimmed = answer.trim()
    const currentTurn: ScoutMockInterviewTurn = {
      question: session.currentQuestion ?? "",
      answer: trimmed,
    }
    const updatedHistory = [...session.history, currentTurn]

    setAnswer("")

    const data = await callAPI({
      history: updatedHistory,
      currentAnswer: trimmed,
      questionIndex: session.questionIndex + 1,
      sessionId: session.sessionId,
    })

    if (!data) return

    // Attach feedback to the turn we just answered
    const historyWithFeedback = updatedHistory.map((t, i) =>
      i === updatedHistory.length - 1 ? { ...t, feedback: data.feedback ?? undefined } : t
    )

    setSession((prev) =>
      prev
        ? {
            ...prev,
            history: historyWithFeedback,
            currentQuestion: data.question ?? null,
            questionIndex: data.questionIndex ?? prev.questionIndex + 1,
            totalQuestions: data.totalQuestions ?? prev.totalQuestions,
            isComplete: data.isComplete ?? false,
            pendingFeedback: data.feedback ?? null,
          }
        : prev
    )
  }

  // ── Reset ─────────────────────────────────────────────────────────────────

  function resetSession() {
    setSession(null)
    setAnswer("")
    setApiError(null)
    setGateMessage(null)
  }

  // ── Closed state ─────────────────────────────────────────────────────────

  if (!isOpen) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border border-orange-100 bg-orange-50">
            <Mic2 className="h-5 w-5 text-orange-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-950">Text mock interview</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Practice answering questions for {roleLabel}. Scout asks one question at a time
              and gives you feedback after each answer.
            </p>
            <ul className="mt-2 space-y-1">
              {["Role-specific questions based on the job", "Feedback after every answer", "No video or audio required"].map(
                (item) => (
                  <li key={item} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                    {item}
                  </li>
                )
              )}
            </ul>
          </div>
          <button
            type="button"
            onClick={() => { setIsOpen(true); startSession() }}
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Start interview
          </button>
        </div>
      </div>
    )
  }

  // ── Session complete ──────────────────────────────────────────────────────

  if (session?.isComplete) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-900">Interview complete</p>
              <p className="mt-0.5 text-xs text-emerald-700">
                You answered {session.history.filter((t) => t.answer).length} question
                {session.history.filter((t) => t.answer).length !== 1 ? "s" : ""}. Review your
                feedback below.
              </p>
            </div>
            <button
              type="button"
              onClick={resetSession}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Start over
            </button>
          </div>
        </div>

        {session.history.map((turn, i) => (
          <div key={i} className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Question {i + 1}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{turn.question}</p>
              {turn.answer && (
                <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                    Your answer
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-700">{turn.answer}</p>
                </div>
              )}
            </div>
            {turn.feedback && <FeedbackCard feedback={turn.feedback} />}
          </div>
        ))}
      </div>
    )
  }

  // ── Active session ────────────────────────────────────────────────────────

  const lastTurn = session?.history[session.history.length - 1]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-orange-600">
            <MessageSquare className="h-3.5 w-3.5 text-white" />
          </div>
          <p className="text-sm font-bold text-slate-950">Mock Interview</p>
          <span className="rounded-full border border-orange-100 bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-orange-700">
            Text mode
          </span>
        </div>
        <button
          type="button"
          onClick={resetSession}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
          End session
        </button>
      </div>

      {/* Progress */}
      {session && (
        <ProgressBar
          current={session.questionIndex}
          total={session.totalQuestions}
        />
      )}

      {/* Last feedback (from previous answer) */}
      {lastTurn?.feedback && (
        <FeedbackCard feedback={lastTurn.feedback} />
      )}

      {/* Loading question */}
      {isLoading && !session?.currentQuestion && (
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-orange-600" />
          <p className="text-sm text-slate-500">Scout is preparing your next question…</p>
        </div>
      )}

      {/* Current question */}
      {session?.currentQuestion && !session.isComplete && (
        <div className="rounded-2xl border border-orange-100 bg-orange-50/60 px-5 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-orange-500">
            Question {session.questionIndex} of {session.totalQuestions}
          </p>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-900">
            {session.currentQuestion}
          </p>
        </div>
      )}

      {/* Gate */}
      {gateMessage && (
        <GateCard
          upgradeMessage={gateMessage}
          onUpgrade={() => showUpgrade("interview_prep")}
        />
      )}

      {/* Error */}
      {apiError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {apiError}
          <button
            type="button"
            onClick={() => setApiError(null)}
            className="ml-2 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Answer textarea */}
      {session?.currentQuestion && !session.isComplete && !gateMessage && (
        <div className="space-y-2">
          <textarea
            ref={textareaRef}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your answer here…"
            disabled={isLoading}
            rows={4}
            className="w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              {answer.trim().split(/\s+/).filter(Boolean).length} words
            </p>
            <button
              type="button"
              onClick={submitAnswer}
              disabled={!answer.trim() || isLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:opacity-40"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {isLoading ? "Submitting…" : "Submit answer"}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
