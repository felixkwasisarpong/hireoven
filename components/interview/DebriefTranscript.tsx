"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import MessageBubble from "@/components/interview/MessageBubble"

type Turn = {
  id: string
  role: string
  content: string
  turnIndex: number
}

export default function DebriefTranscript({ turns, finalCode, language }: {
  turns: Turn[]
  finalCode?: string | null
  language?: string
}) {
  const [open, setOpen] = useState(false)

  const visible = turns.filter((t) => t.role !== "system")

  if (visible.length === 0 && !finalCode) return null

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left"
      >
        <span className="text-[13px] font-semibold text-slate-700">
          Transcript ({visible.length} turns)
        </span>
        {open
          ? <ChevronUp className="h-4 w-4 text-slate-400" />
          : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {visible.map((turn) => (
            <MessageBubble
              key={turn.id}
              role={turn.role === "candidate" ? "candidate" : "interviewer"}
              content={turn.content}
            />
          ))}
          {finalCode && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Final submitted code</p>
              <pre className="overflow-x-auto rounded-xl bg-slate-800 p-4 font-mono text-[12px] text-slate-200">
                <code>{finalCode}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
