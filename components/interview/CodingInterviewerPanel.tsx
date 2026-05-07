"use client"

import { useRef, useEffect, useState } from "react"
import { Send } from "lucide-react"
import { cn } from "@/lib/utils"

type AgentMessage = {
  id: string
  role: "interviewer" | "candidate"
  content: string
  isHint?: boolean
  ts: number
}

function fmt(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
}

type Props = {
  messages: AgentMessage[]
  onSendMessage: (content: string) => void
  onHint: () => void
  hintsUsed: number
  hintsTotal: number
  isLoading: boolean
  sessionCompleted?: boolean
}

export default function CodingInterviewerPanel({
  messages,
  onSendMessage,
  onHint,
  hintsUsed,
  hintsTotal,
  isLoading,
  sessionCompleted,
}: Props) {
  const [input, setInput] = useState("")
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  function handleSend() {
    const trimmed = input.trim()
    if (!trimmed || isLoading) return
    onSendMessage(trimmed)
    setInput("")
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleSend() }
  }

  const hintsExhausted = hintsUsed >= hintsTotal

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 px-3 py-2">
        <p className="text-[12px] font-semibold text-slate-700">Interviewer</p>
      </div>

      {/* Chat thread */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((msg) => {
          const isCandidate = msg.role === "candidate"
          return (
            <div key={msg.id} className={cn("flex flex-col gap-0.5", isCandidate ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[90%] rounded-xl px-3 py-2 text-[12px] leading-relaxed",
                  msg.isHint
                    ? "border border-amber-200 bg-amber-50 text-amber-800"
                    : isCandidate
                      ? "bg-orange-500 text-white"
                      : "border border-slate-100 bg-white text-slate-800 shadow-sm"
                )}
              >
                {msg.isHint && (
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-amber-600">Hint</p>
                )}
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              </div>
              <span className="text-[10px] text-slate-400">{fmt(msg.ts)}</span>
            </div>
          )
        })}

        {isLoading && (
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-100 bg-white px-3 py-2 shadow-sm w-fit">
            {[0, 160, 320].map((d) => (
              <span
                key={d}
                className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-bounce"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Actions + composer */}
      {!sessionCompleted && (
        <div className="border-t border-slate-200 p-3 space-y-2">
          <button
            type="button"
            onClick={onHint}
            disabled={hintsExhausted || isLoading}
            title={hintsExhausted ? "No more hints" : `Hint (${hintsUsed}/${hintsTotal} used)`}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition w-full justify-center",
              hintsExhausted
                ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
            )}
          >
            💡 Hint {hintsUsed}/{hintsTotal}
          </button>

          <div className="flex items-end gap-2 rounded-xl border-2 border-slate-200 bg-white px-2 py-1.5 focus-within:border-orange-300">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              placeholder="Ask a clarifying question…"
              rows={2}
              className="w-full resize-none bg-transparent text-[12px] leading-relaxed text-slate-800 outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-500 text-white disabled:opacity-40"
            >
              <Send className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
