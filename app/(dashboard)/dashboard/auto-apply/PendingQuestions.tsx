"use client"

import { useState } from "react"
import { Check, HelpCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export type PendingQuestion = {
  id: string
  questionText: string
  options: string[] | null
  companyScope: string | null
  timesSeen: number
}

/**
 * The questions auto-apply hit and could not answer.
 *
 * These are the actual reason applications stall — not a broken form filler,
 * but employers asking things no résumé contains. Each answer is stored and
 * reused on every future application, so this shrinks as it is used rather than
 * becoming a standing chore. Ordered by how often each question was
 * encountered, so the first few answers unblock the most applications.
 */
export default function PendingQuestions({ initial }: { initial: PendingQuestion[] }) {
  const [questions, setQuestions] = useState(initial)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  if (questions.length === 0) return null

  async function save(id: string, answer: string) {
    if (!answer.trim()) return
    setSaving(id)
    try {
      const res = await fetch("/api/auto-apply/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, answer }),
      })
      // Only drop the question once the server confirms; otherwise it silently
      // disappears from the UI while remaining unanswered for the next run.
      if (res.ok) setQuestions((q) => q.filter((x) => x.id !== id))
    } finally {
      setSaving(null)
    }
  }

  return (
    <section className="mb-6 rounded-lg border border-sky-200 bg-sky-50/60 p-4">
      <div className="flex items-start gap-2.5">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {questions.length} question{questions.length === 1 ? "" : "s"} we couldn&apos;t answer
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Employers asked these and your profile doesn&apos;t cover them. Answer once and we&apos;ll
            reuse it on every future application.
          </p>
        </div>
      </div>

      <ul className="mt-4 space-y-3">
        {questions.map((q) => (
          <li key={q.id} className="rounded-md border border-slate-200 bg-white p-3">
            <p className="text-sm font-medium text-slate-900">{q.questionText}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {q.companyScope
                ? `Specific to ${q.companyScope} — only used there`
                : `Asked on ${q.timesSeen} application${q.timesSeen === 1 ? "" : "s"}`}
            </p>

            {q.options && q.options.length > 0 ? (
              // Show the form's own choices rather than a free-text box, so the
              // stored answer is one the ATS will actually accept.
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    disabled={saving === q.id}
                    onClick={() => void save(q.id, opt)}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-sm transition-colors",
                      "border-slate-300 text-slate-700 hover:border-sky-400 hover:bg-sky-50",
                      saving === q.id && "opacity-50",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2.5 flex gap-2">
                <input
                  value={drafts[q.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void save(q.id, drafts[q.id] ?? "")
                  }}
                  placeholder="Your answer"
                  className="flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-sky-400"
                />
                <button
                  disabled={saving === q.id || !(drafts[q.id] ?? "").trim()}
                  onClick={() => void save(q.id, drafts[q.id] ?? "")}
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  {saving === q.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5" />}
                  Save
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
