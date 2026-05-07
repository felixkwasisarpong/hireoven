"use client"

import { useRef, useState } from "react"
import { Send } from "lucide-react"
import { cn } from "@/lib/utils"

type Props = {
  onSend: (content: string) => void
  disabled?: boolean
}

export default function MessageComposer({ onSend, disabled }: Props) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue("")
    // reset height
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault()
      handleSubmit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value)
    // auto-grow
    const el = textareaRef.current
    if (el) {
      el.style.height = "auto"
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }
  }

  const canSend = value.trim().length > 0 && !disabled

  return (
    <form onSubmit={handleSubmit}>
      <div
        className={cn(
          "flex items-end gap-2 rounded-xl border-2 bg-white px-3 py-2 transition",
          disabled
            ? "border-slate-100 opacity-60"
            : "border-slate-200 focus-within:border-orange-300 focus-within:shadow-[0_0_0_3px_rgba(249,115,22,0.08)]"
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Type your answer… (⌘↵ to send)"
          rows={1}
          className="max-h-40 min-h-[36px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500 text-white shadow-sm transition hover:bg-orange-600 disabled:opacity-40 disabled:shadow-none"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </form>
  )
}
