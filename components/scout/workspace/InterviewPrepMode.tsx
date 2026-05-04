"use client"

import { useCallback, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lightbulb,
  MessageSquareText,
  Mic2,
  Play,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { buildInterviewQuestions } from "@/lib/scout/interview/questions"
import {
  writeInterviewSession,
  makeInterviewSessionId,
} from "@/lib/scout/interview/store"
import {
  QUESTION_CATEGORY_META,
  INTERVIEW_TYPE_LABELS,
} from "@/lib/scout/interview/types"
import type {
  ScoutInterviewSession,
  ScoutInterviewQuestion,
  ScoutInterviewType,
  ScoutInterviewQuestionCategory,
} from "@/lib/scout/interview/types"
import type { ScoutResponse } from "@/lib/scout/types"
import type { ActiveEntities } from "./ScoutWorkspaceShell"
import { getScoutDisplayText } from "@/lib/scout/display-text"
import { ScoutMockInterview } from "@/components/scout/ScoutMockInterview"

// ── Question card ─────────────────────────────────────────────────────────────

function QuestionCard({
  q,
  index,
  onAsk,
}: {
  q:      ScoutInterviewQuestion
  index:  number
  onAsk:  (question: string) => void
}) {
  const [open, setOpen] = useState(false)
  const meta = QUESTION_CATEGORY_META[q.category]

  return (
    <div className={cn("rounded-xl border p-3.5 transition-all", meta.bg)}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 flex-shrink-0 text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 border", meta.bg, meta.accent)}>
          {QUESTION_CATEGORY_META[q.category].label}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-snug text-slate-800">{q.question}</p>

          {(q.hints || q.relatedSkills) && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-slate-400 transition hover:text-slate-600"
            >
              {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {open ? "Hide hints" : "Show hints"}
            </button>
          )}

          {open && (
            <div className="mt-2 space-y-1.5">
              {q.hints?.map((hint, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Lightbulb className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" />
                  <p className="text-[11px] text-slate-600">{hint}</p>
                </div>
              ))}
              {q.relatedSkills && q.relatedSkills.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {q.relatedSkills.map((s) => (
                    <span key={s} className="rounded-md bg-white/70 border border-white/50 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {s}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onAsk(q.question)}
          title="Ask Scout for guidance"
          className="flex-shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-white/60 hover:text-slate-600"
        >
          <MessageSquareText className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Category filter tabs ──────────────────────────────────────────────────────

const CATEGORY_ORDER: ScoutInterviewQuestionCategory[] = [
  "behavioral", "technical", "system_design", "resume", "company"
]

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  response:        ScoutResponse
  onFollowUp:      (query: string) => void
  activeEntities?: ActiveEntities
}

export function InterviewPrepMode({ response, onFollowUp, activeEntities }: Props) {
  const prep         = response.interviewPrep
  const answerText   = getScoutDisplayText(response.answer)
  const wdPayload    = response.workspace_directive?.mode === "interview"
    ? (response.workspace_directive.payload ?? {})
    : {}

  const interviewType  = (wdPayload.interviewType as ScoutInterviewType | undefined)
  const companyName    = (wdPayload.companyName as string | undefined) ?? activeEntities?.companyName
  const jobTitle       = (wdPayload.jobTitle    as string | undefined) ?? activeEntities?.jobTitle
  const jobId          = (wdPayload.jobId       as string | undefined) ?? activeEntities?.jobId
  const companyId      = (wdPayload.companyId   as string | undefined) ?? activeEntities?.companyId

  // ── Build questions ──────────────────────────────────────────────────────────
  const questions = useMemo(
    () => prep ? buildInterviewQuestions(prep) : [],
    [prep]
  )

  // ── Category filter ──────────────────────────────────────────────────────────
  const [activeCategory, setActiveCategory] = useState<ScoutInterviewQuestionCategory | "all">("all")

  const filteredQuestions = activeCategory === "all"
    ? questions
    : questions.filter((q) => q.category === activeCategory)

  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<ScoutInterviewQuestionCategory, number>> = {}
    for (const q of questions) {
      counts[q.category] = (counts[q.category] ?? 0) + 1
    }
    return counts
  }, [questions])

  // ── Mock interview sub-view ──────────────────────────────────────────────────
  const [mockActive, setMockActive] = useState(false)

  const startMockSession = useCallback(() => {
    if (!prep) return
    const session: ScoutInterviewSession = {
      id:                makeInterviewSessionId(),
      jobId,
      companyId,
      companyName,
      jobTitle,
      type:              interviewType,
      status:            "active",
      focusAreas:        prep.roleFocus,
      generatedQuestions: questions,
      createdAt:         new Date().toISOString(),
      activeAt:          new Date().toISOString(),
    }
    writeInterviewSession(session)
    setMockActive(true)
  }, [prep, questions, jobId, companyId, companyName, jobTitle, interviewType])

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (!prep) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-5">
        <p className="text-sm font-semibold text-gray-900">Interview Prep</p>
        <p className="mt-2 text-sm text-gray-500">
          Open a job and ask Scout to prepare your interview to generate a tailored prep plan.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {["Prepare me for this interview", "What questions should I expect?", "Help me prep for the technical round"].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onFollowUp(chip)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Mock interview active ────────────────────────────────────────────────────
  if (mockActive) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mic2 className="h-4 w-4 text-[#FF5C18]" />
            <p className="text-sm font-semibold text-slate-900">Mock Interview Session</p>
            {companyName && (
              <span className="text-sm text-slate-400">— {companyName}</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMockActive(false)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-700"
          >
            <X className="h-3 w-3" />
            Back to prep
          </button>
        </div>
        <ScoutMockInterview
          jobId={jobId}
          resumeId={undefined}
          jobTitle={jobTitle}
          companyName={companyName}
        />
      </div>
    )
  }

  // ── Full prep workspace ──────────────────────────────────────────────────────
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_220px]">

      {/* ── Left: questions + plan ─────────────────────────────────────── */}
      <div className="space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-[#FF5C18]" />
              <p className="text-sm font-semibold text-slate-900">
                Interview Prep
                {interviewType && ` — ${INTERVIEW_TYPE_LABELS[interviewType]}`}
              </p>
            </div>
            {(jobTitle || companyName) && (
              <p className="mt-0.5 text-[11px] text-slate-400">
                {jobTitle ?? ""}
                {jobTitle && companyName ? " at " : ""}
                {companyName ?? ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={startMockSession}
            className="flex-shrink-0 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
          >
            <Play className="h-3.5 w-3.5" />
            Start Mock Interview
          </button>
        </div>

        {/* Focus areas */}
        {prep.roleFocus.length > 0 && (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Focus Areas</p>
            <div className="flex flex-wrap gap-2">
              {prep.roleFocus.map((area) => (
                <span
                  key={area}
                  className="rounded-full bg-white border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  {area}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Practice questions */}
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Practice Questions ({questions.length})
            </p>
            {/* Category filter chips */}
            <div className="flex gap-1.5 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveCategory("all")}
                className={cn(
                  "flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition",
                  activeCategory === "all"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                )}
              >
                All ({questions.length})
              </button>
              {CATEGORY_ORDER.map((cat) => {
                const count = categoryCounts[cat]
                if (!count) return null
                const meta = QUESTION_CATEGORY_META[cat]
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={cn(
                      "flex-shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition",
                      activeCategory === cat
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                    )}
                  >
                    {meta.label} ({count})
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-2.5">
            {filteredQuestions.map((q, i) => (
              <QuestionCard
                key={q.id}
                q={q}
                index={i}
                onAsk={(question) => onFollowUp(`Help me answer: "${question}"`)}
              />
            ))}
          </div>
        </div>

        {/* Gaps to prepare */}
        {prep.gapsToPrepare.length > 0 && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Gaps to Prepare</p>
            </div>
            <ul className="space-y-1.5">
              {prep.gapsToPrepare.map((gap) => (
                <li key={gap} className="flex items-start gap-2 text-xs text-amber-700">
                  <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-amber-400" />
                  {gap}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Follow-up chips */}
        <div className="flex flex-wrap gap-2">
          {[
            "Give me a tougher version of this question",
            "How should I answer compensation questions?",
            "Draft a post-interview follow-up",
            "Refine my answer structure",
          ].map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onFollowUp(chip)}
              className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: intelligence rail ────────────────────────────────────── */}
      <div className="hidden space-y-5 lg:block">

        {/* Scout guidance */}
        {answerText && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Scout Guidance
            </p>
            <p className="text-xs leading-5 text-slate-600">{answerText}</p>
          </div>
        )}

        {/* Resume talking points */}
        {prep.resumeTalkingPoints.length > 0 && (
          <div className={answerText ? "border-t border-slate-100 pt-4" : ""}>
            <div className="mb-2 flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 text-emerald-500" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Resume Talking Points
              </p>
            </div>
            <ul className="space-y-1.5">
              {prep.resumeTalkingPoints.map((pt) => (
                <li key={pt} className="flex items-start gap-2 text-xs text-slate-600">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 flex-shrink-0 text-emerald-400" />
                  {pt}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Likely topics */}
        {prep.likelyTopics.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <div className="mb-2 flex items-center gap-1.5">
              <BookOpen className="h-3 w-3 text-blue-500" />
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Likely Topics
              </p>
            </div>
            <ul className="space-y-1.5">
              {prep.likelyTopics.map((topic) => (
                <li key={topic} className="text-xs text-slate-600">
                  · {topic}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Company notes */}
        {prep.companyNotes && prep.companyNotes.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Company Notes
            </p>
            <ul className="space-y-1.5">
              {prep.companyNotes.map((note) => (
                <li key={note} className="text-xs text-slate-500 italic">{note}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Mock interview CTA (repeat on right rail) */}
        <div className="border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={startMockSession}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
          >
            <Mic2 className="h-3.5 w-3.5" />
            Start mock session
            <ArrowRight className="h-3 w-3 text-slate-400" />
          </button>
          <p className="mt-1.5 text-[10px] text-center text-slate-400">
            Practice with live Q&A + feedback
          </p>
        </div>
      </div>
    </div>
  )
}
