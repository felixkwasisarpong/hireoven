"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Loader2, Pencil, RotateCcw } from "lucide-react"

type Props = {
  body: string
  editable?: boolean
  isRegenerating?: boolean
  onUpdate?: (newBody: string) => void
  onRegenerateParagraph?: (index: number, instruction: string) => void
}

function ParagraphEditor({
  index,
  onSubmit,
  onCancel,
}: {
  index: number
  onSubmit: (index: number, instruction: string) => void
  onCancel: () => void
}) {
  const [instruction, setInstruction] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        type="text"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && instruction.trim()) onSubmit(index, instruction.trim())
          if (e.key === "Escape") onCancel()
        }}
        placeholder="How should I change this? e.g. 'Make it more specific to React'"
        className="flex-1 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 outline-none focus:border-[#0369A1] focus:ring-1 focus:ring-[#0369A1]"
      />
      <button
        type="button"
        disabled={!instruction.trim()}
        onClick={() => instruction.trim() && onSubmit(index, instruction.trim())}
        className="flex items-center gap-1.5 rounded-xl bg-[#0369A1] px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-40 hover:bg-[#075985]"
      >
        Rewrite
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
      >
        Cancel
      </button>
    </div>
  )
}

export default function CoverLetterDocument({
  body,
  editable = false,
  isRegenerating = false,
  onUpdate,
  onRegenerateParagraph,
}: Props) {
  const [editingParagraph, setEditingParagraph] = useState<number | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [saved, setSaved] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const paragraphs = body.split("\n\n").filter(Boolean)
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })

  // Sync contenteditable with body prop when not editing
  useEffect(() => {
    if (!isEditing && contentRef.current) {
      contentRef.current.innerText = body
    }
  }, [body, isEditing])

  function handleInput() {
    const text = contentRef.current?.innerText ?? ""
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaved(false)
    saveTimerRef.current = setTimeout(() => {
      onUpdate?.(text)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }, 2000)
  }

  function handleRegenerate(index: number, instruction: string) {
    setEditingParagraph(null)
    onRegenerateParagraph?.(index, instruction)
  }

  if (editable && isEditing) {
    return (
      <div className="relative">
        <div
          ref={contentRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onBlur={() => setIsEditing(false)}
          className="min-h-[400px] whitespace-pre-wrap rounded-2xl border border-[#0369A1] bg-[#FAFCFF] p-6 font-serif text-[15px] leading-8 text-gray-800 outline-none focus:ring-1 focus:ring-[#0369A1]"
        />
        <div className="absolute right-4 top-4 flex items-center gap-1.5 text-xs text-gray-400">
          {saved ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-500" />
              <span className="text-emerald-600">Saved</span>
            </>
          ) : (
            "Editing…"
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {isRegenerating && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-white/80 backdrop-blur-sm">
          <div className="flex items-center gap-2.5 text-sm text-gray-600">
            <Loader2 className="h-4 w-4 animate-spin text-[#0369A1]" />
            Rewriting paragraph…
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-[#FDFCFB] shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
        {/* Paper header */}
        <div className="border-b border-gray-100 px-8 pt-7 pb-5">
          <p className="text-sm text-gray-500">{today}</p>
        </div>

        {/* Body */}
        <div className="px-8 py-6 space-y-0">
          {paragraphs.map((para, i) => (
            <div
              key={i}
              className="group relative"
            >
              <p className="font-serif text-[15px] leading-8 text-gray-800 mb-5 whitespace-pre-wrap">
                {para}
              </p>

              {editable && editingParagraph === i ? (
                <ParagraphEditor
                  index={i}
                  onSubmit={handleRegenerate}
                  onCancel={() => setEditingParagraph(null)}
                />
              ) : editable ? (
                <div className="absolute -right-2 top-0 hidden group-hover:flex gap-1">
                  <button
                    type="button"
                    onClick={() => setEditingParagraph(i)}
                    className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 shadow-sm transition hover:border-gray-300 hover:text-gray-800"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Rewrite
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(true)
                      requestAnimationFrame(() => contentRef.current?.focus())
                    }}
                    className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-medium text-gray-500 shadow-sm transition hover:border-gray-300 hover:text-gray-800"
                  >
                    <Pencil className="h-3 w-3" />
                    Edit
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
