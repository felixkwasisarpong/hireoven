"use client"

import { useMemo, useState } from "react"
import { Loader2, Wand2, X } from "lucide-react"
import type { Resume, ResumeEditSuggestion } from "@/types"

type KeywordInjectorProps = {
  keyword: string
  resume: Resume
  jobId?: string
  open: boolean
  onClose: () => void
  onQueueSuggestion?: (suggestion: ResumeEditSuggestion) => void
  onAcceptSuggestion?: (editId: string) => Promise<unknown>
}

export default function KeywordInjector({
  keyword,
  resume,
  jobId,
  open,
  onClose,
  onQueueSuggestion,
  onAcceptSuggestion,
}: KeywordInjectorProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [suggestion, setSuggestion] = useState<ResumeEditSuggestion | null>(null)

  const bulletOptions = useMemo(
    () =>
      (resume.work_experience ?? []).flatMap((experience, experienceIndex) =>
        experience.achievements.map((achievement, bulletIndex) => ({
          id: `${experienceIndex}:${bulletIndex}`,
          label: `${experience.title} · ${experience.company}`,
          content: achievement,
          experienceIndex,
          bulletIndex,
        }))
      ),
    [resume.work_experience]
  )

  if (!open) return null

  async function generateSuggestion() {
    const selected = bulletOptions.find((option) => option.id === selectedKey)
    if (!selected) return

    setLoading(true)
    const response = await fetch("/api/resume/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumeId: resume.id,
        section: "work_experience",
        originalContent: selected.content,
        editType: "keyword_inject",
        jobId,
        missingKeywords: [keyword],
        context: {
          experienceIndex: selected.experienceIndex,
          bulletIndex: selected.bulletIndex,
          field: "achievement",
          keyword,
        },
      }),
    })
    const data = await response.json()
    setLoading(false)

    if (!response.ok) {
      throw new Error(data.error ?? "Failed to inject keyword")
    }

    const nextSuggestion: ResumeEditSuggestion = {
      id: data.editId,
      user_id: resume.user_id,
      resume_id: resume.id,
      job_id: jobId ?? null,
      section: "work_experience",
      original_content: selected.content,
      suggested_content: data.suggestion,
      edit_type: "keyword_inject",
      keywords_added: data.keywordsAdded ?? [keyword],
      was_accepted: null,
      feedback: null,
      context: {
        experienceIndex: selected.experienceIndex,
        bulletIndex: selected.bulletIndex,
        field: "achievement",
        keyword,
      },
      created_at: new Date().toISOString(),
    }

    setSuggestion(nextSuggestion)
    onQueueSuggestion?.(nextSuggestion)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
      <div className="w-full max-w-3xl rounded-[28px] border border-white/70 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.20)]">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#0369A1]">
              Keyword injector
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-gray-900">
              Add “{keyword}” to the right bullet
            </h3>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              Pick the bullet where this keyword fits naturally. Hireoven will rewrite only that line.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 p-2 text-gray-500 transition hover:bg-gray-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="space-y-3">
            {bulletOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelectedKey(option.id)}
                className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                  selectedKey === option.id
                    ? "border-[#7DD3FC] bg-[#F5FBFF]"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
                  {option.label}
                </p>
                <p className="mt-2 text-sm leading-6 text-gray-700">{option.content}</p>
              </button>
            ))}
          </div>

          {suggestion && (
            <div className="mt-5 rounded-2xl border border-[#BAE6FD] bg-[#F5FBFF] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0369A1]">
                Suggested rewrite
              </p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <p className="text-sm leading-6 text-gray-500 line-through decoration-gray-300">
                  {suggestion.original_content}
                </p>
                <p className="text-sm leading-6 text-gray-800">{suggestion.suggested_content}</p>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  type="button"
                  onClick={async () => {
                    if (!suggestion || !onAcceptSuggestion) return
                    await onAcceptSuggestion(suggestion.id)
                    onClose()
                  }}
                  className="rounded-2xl bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985]"
                >
                  Accept and apply
                </button>
                <button
                  type="button"
                  onClick={() => setSuggestion(null)}
                  className="rounded-2xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-6 py-4">
          <p className="text-sm text-gray-500">
            One keyword at a time keeps the resume natural.
          </p>
          <button
            type="button"
            disabled={!selectedKey || loading}
            onClick={() => void generateSuggestion()}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0369A1] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#075985] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            Inject keyword
          </button>
        </div>
      </div>
    </div>
  )
}
