"use client"

import { useEffect, useRef, useState } from "react"
import {
  Check,
  Eraser,
  Expand,
  Minus,
  Pencil,
  Sigma,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { ResumeEditSuggestion } from "@/types"

type ActionType = "rewrite" | "quantify" | "keyword_inject" | "expand" | "shorten"

type BulletEditorProps = {
  content: string
  onUpdate: (newContent: string) => void
  onDelete: () => void
  resumeId: string
  jobId?: string
  missingKeywords?: string[]
  experienceIndex: number
  bulletIndex: number
  roleTitle: string
  companyName: string
  onQueueSuggestion?: (suggestion: ResumeEditSuggestion) => void
  onAcceptSuggestion?: (editId: string) => Promise<unknown>
  onRejectSuggestion?: (editId: string, feedback?: string) => Promise<void>
}

const REJECTION_FEEDBACK = ["Too formal", "Not my voice", "Inaccurate", "Other"]

export default function BulletEditor({
  content,
  onUpdate,
  onDelete,
  resumeId,
  jobId,
  missingKeywords = [],
  experienceIndex,
  bulletIndex,
  roleTitle,
  companyName,
  onQueueSuggestion,
  onAcceptSuggestion,
  onRejectSuggestion,
}: BulletEditorProps) {
  const [mode, setMode] = useState<"view" | "editing" | "loading" | "suggestion">("view")
  const [draft, setDraft] = useState(content)
  const [suggestion, setSuggestion] = useState<ResumeEditSuggestion | null>(null)
  const [showRejectOptions, setShowRejectOptions] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    setDraft(content)
  }, [content])

  useEffect(() => {
    if (mode !== "editing" || !textareaRef.current) return
    const textarea = textareaRef.current
    textarea.style.height = "0px"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [draft, mode])

  async function runAction(action: ActionType) {
    setMode("loading")
    setShowRejectOptions(false)

    const response = await fetch("/api/resume/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resumeId,
        section: "work_experience",
        originalContent: content,
        editType: action,
        jobId,
        missingKeywords,
        context: {
          experienceIndex,
          bulletIndex,
          field: "achievement",
        },
      }),
    })

    const data = await response.json()
    if (!response.ok) {
      setMode("view")
      throw new Error(data.error ?? "Failed to generate suggestion")
    }

    const nextSuggestion: ResumeEditSuggestion = {
      id: data.editId,
      user_id: "",
      resume_id: resumeId,
      job_id: jobId ?? null,
      section: "work_experience",
      original_content: content,
      suggested_content: data.suggestion,
      edit_type: action,
      keywords_added: data.keywordsAdded ?? [],
      was_accepted: null,
      feedback: null,
      context: {
        experienceIndex,
        bulletIndex,
        field: "achievement",
      },
      created_at: new Date().toISOString(),
    }

    setSuggestion(nextSuggestion)
    onQueueSuggestion?.(nextSuggestion)
    setMode("suggestion")
  }

  async function handleAccept() {
    if (!suggestion) return
    if (onAcceptSuggestion) {
      await onAcceptSuggestion(suggestion.id)
    } else {
      onUpdate(suggestion.suggested_content)
    }
    setMode("view")
    setSuggestion(null)
  }

  async function handleReject(feedback?: string) {
    if (!suggestion) return
    await onRejectSuggestion?.(suggestion.id, feedback)
    setShowRejectOptions(false)
    setMode("view")
    setSuggestion(null)
  }

  if (mode === "loading") {
    return (
      <div className="rounded-2xl border border-[#D6EEFF] bg-[#F5FBFF] px-4 py-3 text-sm text-[#0C4A6E]">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 animate-pulse" />
          AI is rewriting this bullet…
        </div>
      </div>
    )
  }

  if (mode === "suggestion" && suggestion) {
    return (
      <div className="rounded-2xl border border-[#BAE6FD] bg-[#F5FBFF] p-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-400">
              Original
            </p>
            <p className="mt-2 text-sm leading-6 text-gray-500 line-through decoration-gray-300">
              {suggestion.original_content}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0369A1]">
              Suggested
            </p>
            <p className="mt-2 text-sm leading-6 text-gray-800">{suggestion.suggested_content}</p>
            {(suggestion.keywords_added?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {suggestion.keywords_added?.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full border border-[#BAE6FD] bg-white px-2.5 py-1 text-[11px] font-medium text-[#0C4A6E]"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleAccept()}
            className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700"
          >
            <Check className="h-4 w-4" />
            Accept
          </button>
          <button
            type="button"
            onClick={() => setShowRejectOptions((current) => !current)}
            className="inline-flex items-center gap-2 rounded-2xl border border-red-200 px-3.5 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            <X className="h-4 w-4" />
            Reject
          </button>
          <button
            type="button"
            onClick={() => void runAction((suggestion.edit_type ?? "rewrite") as ActionType)}
            className="rounded-2xl border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition hover:bg-white"
          >
            Regenerate
          </button>
        </div>

        {showRejectOptions && (
          <div className="mt-3 flex flex-wrap gap-2">
            {REJECTION_FEEDBACK.map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => void handleReject(label)}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:border-gray-300"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  if (mode === "editing") {
    return (
      <div className="rounded-2xl border border-[#D6EEFF] bg-white p-3">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              onUpdate(draft.trim())
              setMode("view")
            }
            if (event.key === "Escape") {
              setDraft(content)
              setMode("view")
            }
          }}
          className="min-h-[60px] w-full resize-none bg-transparent text-sm leading-6 text-gray-800 outline-none"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400">
            {roleTitle} at {companyName}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(content)
                setMode("view")
              }}
              className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdate(draft.trim())
                setMode("view")
              }}
              className="rounded-xl bg-[#0369A1] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group rounded-2xl border border-transparent px-3 py-2 transition hover:border-gray-200 hover:bg-white">
      <div className="flex items-start gap-3">
        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-gray-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-6 text-gray-700">{content}</p>

          <div className="mt-2 flex flex-wrap items-center gap-1 opacity-0 transition group-hover:opacity-100">
            {[
              { icon: Pencil, label: "Rewrite", action: "rewrite" as ActionType },
              { icon: Sigma, label: "Quantify", action: "quantify" as ActionType },
              { icon: Sparkles, label: "Keywords", action: "keyword_inject" as ActionType },
              { icon: Expand, label: "Expand", action: "expand" as ActionType },
              { icon: Minus, label: "Shorten", action: "shorten" as ActionType },
            ].map(({ icon: Icon, label, action }) => (
              <button
                key={label}
                type="button"
                title={label}
                onClick={() => void runAction(action)}
                className={cn(
                  "rounded-xl border border-gray-200 bg-white p-2 text-gray-500 transition hover:border-[#BAE6FD] hover:text-[#0C4A6E]",
                  label === "Keywords" && missingKeywords.length === 0 && "opacity-50"
                )}
                disabled={label === "Keywords" && missingKeywords.length === 0}
              >
                <Icon className="h-3.5 w-3.5" />
              </button>
            ))}
            <button
              type="button"
              title="Edit"
              onClick={() => setMode("editing")}
              className="rounded-xl border border-gray-200 bg-white p-2 text-gray-500 transition hover:border-gray-300 hover:text-gray-700"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Delete"
              onClick={onDelete}
              className="rounded-xl border border-red-200 bg-white p-2 text-red-500 transition hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Clear draft"
              onClick={() => {
                setDraft("")
                setMode("editing")
              }}
              className="rounded-xl border border-gray-200 bg-white p-2 text-gray-400 transition hover:border-gray-300 hover:text-gray-600"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
