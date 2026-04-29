"use client"

import { useState } from "react"
import { Brain, ChevronDown, ChevronUp, Loader2, Send, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

type Question = {
  id: string
  category: "behavioral" | "technical" | "culture" | "situational" | "curveball"
  question: string
  hint: string
}

type EvalResult = {
  score: number
  strengths: string[]
  improvements: string[]
  better_answer_tip: string
}

const CATEGORY_STYLE: Record<string, string> = {
  behavioral: "bg-blue-50 text-blue-700 border-blue-200",
  technical: "bg-orange-50 text-orange-700 border-orange-200",
  culture: "bg-emerald-50 text-emerald-700 border-emerald-200",
  situational: "bg-amber-50 text-amber-700 border-amber-200",
  curveball: "bg-red-50 text-red-700 border-red-200",
}

function scoreColor(s: number) {
  if (s >= 8) return "text-emerald-600"
  if (s >= 6) return "text-amber-600"
  return "text-red-600"
}

type Props = { applicationId: string }

export function InterviewPrep({ applicationId }: Props) {
  const [questions, setQuestions] = useState<Question[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [evals, setEvals] = useState<Record<string, EvalResult>>({})
  const [evalLoading, setEvalLoading] = useState<string | null>(null)

  async function generateQuestions() {
    setIsLoading(true)
    try {
      const res = await fetch("/api/applications/interview-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, mode: "questions" }),
      })
      const data = await res.json()
      setQuestions(data.questions ?? [])
      if (data.questions?.length) setExpanded(data.questions[0].id)
    } finally {
      setIsLoading(false)
    }
  }

  async function evaluateAnswer(q: Question) {
    const answer = answers[q.id]
    if (!answer?.trim()) return
    setEvalLoading(q.id)
    try {
      const res = await fetch("/api/applications/interview-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          mode: "evaluate",
          question: q.question,
          answer,
        }),
      })
      const data = await res.json()
      setEvals((prev) => ({ ...prev, [q.id]: data }))
    } finally {
      setEvalLoading(null)
    }
  }

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFF1E8]">
          <Brain className="h-7 w-7 text-[#FF5C18]" />
        </div>
        <div>
          <p className="font-semibold text-slate-800">AI interview coach</p>
          <p className="mt-1 text-sm text-slate-500">
            Generate targeted questions and get feedback on your answers
          </p>
        </div>
        <button
          type="button"
          onClick={generateQuestions}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-[12px] bg-[#FF5C18] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#E14F0E] disabled:opacity-60"
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {isLoading ? "Generating…" : "Generate questions"}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">{questions.length} practice questions</p>
        <button
          type="button"
          onClick={generateQuestions}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
        >
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Regenerate
        </button>
      </div>

      {questions.map((q) => {
        const isOpen = expanded === q.id
        const evalResult = evals[q.id]

        return (
          <div key={q.id} className="rounded-[12px] border border-slate-200/80 bg-white overflow-hidden">
            <button
              type="button"
              className="flex w-full items-start gap-3 p-4 text-left hover:bg-slate-50/50 transition"
              onClick={() => setExpanded(isOpen ? null : q.id)}
            >
              <span className={cn("mt-0.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize shrink-0", CATEGORY_STYLE[q.category] ?? "bg-slate-50 text-slate-600")}>
                {q.category}
              </span>
              <span className="flex-1 text-[13.5px] font-medium text-slate-800">{q.question}</span>
              {isOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />}
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-3">
                <p className="text-xs text-slate-500 italic">Tip: {q.hint}</p>

                <textarea
                  placeholder="Type your answer here…"
                  rows={4}
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  className="w-full resize-none rounded-[10px] border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
                />

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => evaluateAnswer(q)}
                    disabled={!answers[q.id]?.trim() || evalLoading === q.id}
                    className="inline-flex items-center gap-1.5 rounded-[10px] bg-[#ea580c] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#c2410c] disabled:opacity-50"
                  >
                    {evalLoading === q.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {evalLoading === q.id ? "Evaluating…" : "Get feedback"}
                  </button>
                </div>

                {evalResult && (
                  <div className="rounded-[10px] border border-slate-200 bg-slate-50/70 p-3.5 space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-2xl font-bold", scoreColor(evalResult.score))}>
                        {evalResult.score}/10
                      </span>
                      <span className="text-xs text-slate-500">answer score</span>
                    </div>

                    {evalResult.strengths.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600">Strengths</p>
                        <ul className="space-y-0.5">
                          {evalResult.strengths.map((s, i) => (
                            <li key={i} className="text-[12.5px] text-slate-700">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {evalResult.improvements.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600">Improve</p>
                        <ul className="space-y-0.5">
                          {evalResult.improvements.map((s, i) => (
                            <li key={i} className="text-[12.5px] text-slate-700">• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {evalResult.better_answer_tip && (
                      <p className="rounded-lg bg-[#FFF1E8] px-3 py-2 text-[12.5px] text-[#9A3412]">
                        💡 {evalResult.better_answer_tip}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
