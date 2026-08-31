"use client"

import { useState } from "react"
import { Check, ChevronDown, HelpCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

export type PendingQuestion = {
  id: string
  questionText: string
  options: string[] | null
  companyScope: string | null
  timesSeen: number
}

/** Shown up front. The rest stay behind "show more" so the page is a task, not a wall. */
const VISIBLE = 4

/**
 * Questions auto-apply hit and could not answer.
 *
 * Deliberately not a full inbox. An earlier version listed all 25 as large
 * cards, which read as homework and buried the four that actually recur — and
 * most of the tail was role-specific ("have you bartended a full bar?") from
 * jobs the user would never take. Ordered by how often each was asked, so the
 * first few answers unblock the most applications, and the rest are collapsed.
 */
export default function PendingQuestions({ initial }: { initial: PendingQuestion[] }) {
  const [questions, setQuestions] = useState(initial)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  if (questions.length === 0) return null

  async function save(id: string, answer: string) {
    if (!answer.trim() || saving) return
    setSaving(id)
    try {
      const res = await fetch("/api/auto-apply/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, answer }),
      })
      // Only drop it once the server confirms; otherwise it vanishes from view
      // while still blocking the next run.
      if (res.ok) setQuestions((q) => q.filter((x) => x.id !== id))
    } finally {
      setSaving(null)
    }
  }

  const shown = expanded ? questions : questions.slice(0, VISIBLE)
  const hidden = questions.length - shown.length

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white">
      <header className="flex items-start gap-2.5 border-b border-slate-100 px-4 py-3">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {questions.length} question{questions.length === 1 ? "" : "s"} blocking applications
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Answer once and we reuse it everywhere. Skip anything that doesn&apos;t apply to you.
          </p>
        </div>
      </header>

      <ul className="divide-y divide-slate-100">
        {shown.map((q) => (
          <li key={q.id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm text-slate-900">{q.questionText}</p>
              {q.timesSeen > 1 && (
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  {q.timesSeen}×
                </span>
              )}
            </div>

            {q.options && q.options.length > 0 ? (
              // The form's own choices, so the stored answer is one the ATS accepts.
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.options.slice(0, 6).map((opt) => (
                  <button
                    key={opt}
                    disabled={saving === q.id}
                    onClick={() => void save(q.id, opt)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-700 transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:opacity-50"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  value={drafts[q.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") void save(q.id, drafts[q.id] ?? "") }}
                  placeholder="Your answer"
                  className="min-w-0 flex-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-sky-400"
                />
                <button
                  disabled={saving === q.id || !(drafts[q.id] ?? "").trim()}
                  onClick={() => void save(q.id, drafts[q.id] ?? "")}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition-opacity disabled:opacity-30"
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

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-slate-100 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          {hidden} more
        </button>
      )}
    </section>
  )
}
