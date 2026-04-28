"use client"

import { useMemo, useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react"
import { ScoutMessageBubble } from "@/components/scout/ScoutMessageBubble"
import { ScoutActivityTimeline } from "@/components/scout/ScoutActivityTimeline"
import { ScoutContextChip } from "@/components/scout/ScoutContextChip"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { normalizeScoutResponse } from "@/lib/scout/normalize"
import type { ScoutResponse } from "@/lib/scout/types"

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "scout"; response: ScoutResponse }

type ScoutMiniPanelProps = {
  pagePath?: string
  jobId?: string
  companyId?: string
  resumeId?: string
  applicationId?: string
  suggestionChips: string[]
}

function CompactTypingIndicator() {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#ea580c]">
        <Sparkles className="h-3.5 w-3.5 text-white" />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-3 py-2.5">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  )
}

export function ScoutMiniPanel({
  pagePath,
  jobId,
  companyId,
  resumeId,
  applicationId,
  suggestionChips,
}: ScoutMiniPanelProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { showUpgrade } = useUpgradeModal()
  const { primaryResume } = useResumeContext()

  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [resumeRefreshedNotice, setResumeRefreshedNotice] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const prevResumeIdRef = useRef<string | null | undefined>(undefined)

  const resolvedPagePath = pagePath ?? pathname ?? "/dashboard"
  const contextIds = useMemo(
    () => ({
      jobId: jobId ?? searchParams.get("jobId") ?? undefined,
      companyId: companyId ?? searchParams.get("companyId") ?? undefined,
      resumeId: resumeId ?? searchParams.get("resumeId") ?? undefined,
      applicationId: applicationId ?? searchParams.get("applicationId") ?? undefined,
    }),
    [applicationId, companyId, jobId, resumeId, searchParams]
  )

  // Auto-scroll on new messages / loading
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  // Detect resume change and clear stale context
  useEffect(() => {
    const currentId = primaryResume?.id ?? null
    if (prevResumeIdRef.current !== undefined && prevResumeIdRef.current !== currentId) {
      setMessages([])
      setError(null)
      setResumeRefreshedNotice(true)
      const t = setTimeout(() => setResumeRefreshedNotice(false), 5_000)
      return () => clearTimeout(t)
    }
    prevResumeIdRef.current = currentId
  }, [primaryResume?.id])

  // Listen for reset-context events (from RESET_CONTEXT action or chip button)
  useEffect(() => {
    function onReset() {
      setMessages([])
      setError(null)
    }
    window.addEventListener("scout:reset-context", onReset)
    return () => window.removeEventListener("scout:reset-context", onReset)
  }, [])

  // Open panel pre-filled from a job card hover "Ask Scout" button
  useEffect(() => {
    function onOpenWithJob(e: Event) {
      const { prefillQuery } = (e as CustomEvent<{ jobId: string; prefillQuery: string }>).detail
      setIsOpen(true)
      setQuery(prefillQuery)
      setTimeout(() => inputRef.current?.focus(), 80)
    }
    window.addEventListener("scout:open-with-job", onOpenWithJob as EventListener)
    return () => window.removeEventListener("scout:open-with-job", onOpenWithJob as EventListener)
  }, [])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const message = query.trim()
    if (!message || isLoading) return

    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: message },
    ])
    setQuery("")
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/scout/chat", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          pagePath: resolvedPagePath,
          focusMode: searchParams.get("focus") === "1",
          activeFilters: {
            q: searchParams.get("q") ?? undefined,
            location: searchParams.get("location") ?? undefined,
            sponsorship: searchParams.get("sponsorship") ?? undefined,
            workMode: searchParams.get("workMode") ?? undefined,
          },
          ...contextIds,
        }),
      })

      const raw = (await res.json().catch(() => null)) as unknown
      if (!res.ok) {
        const errMsg =
          typeof raw === "object" &&
          raw !== null &&
          "error" in (raw as Record<string, unknown>)
            ? String((raw as Record<string, unknown>).error)
            : "Scout could not respond right now."
        setError(errMsg)
        return
      }

      const normalized = normalizeScoutResponse(raw)
      setMessages((prev) => [
        ...prev,
        { id: `s-${Date.now()}`, role: "scout", response: normalized },
      ])
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  function fillChip(chip: string) {
    setQuery(chip)
    inputRef.current?.focus()
  }

  const hasConversation = messages.length > 0

  return (
    <div className="pointer-events-none fixed bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)+4.5rem))] right-4 z-[55] md:bottom-6 md:right-6">
      {isOpen && (
        <section
          className="pointer-events-auto mb-3 flex w-[min(92vw,26rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.22)]"
          style={{ maxHeight: "min(72vh,600px)" }}
        >
          {/* ── Panel header ── */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[#ea580c] text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold text-slate-900">Ask Scout</p>
              {hasConversation && (
                <span className="rounded-full bg-[#ea580c]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ea580c]">
                  {messages.filter((m) => m.role === "user").length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
              aria-label="Close Scout panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Message area ── */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {/* Resume refreshed notice */}
            {resumeRefreshedNotice && (
              <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                Scout refreshed context for your updated resume.
              </div>
            )}

            {/* Active context chip — shown only in empty state */}
            {!hasConversation && !isLoading && (
              <ScoutContextChip onReset={() => setMessages([])} />
            )}

            {/* Empty state */}
            {!hasConversation && !isLoading && (
              <div className="py-4 text-center">
                <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#ea580c]">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <p className="text-xs font-semibold text-slate-900">Scout is ready</p>
                <p className="mt-0.5 text-[11px] text-slate-400">
                  Ask anything about this page
                </p>
              </div>
            )}

            {/* Messages */}
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#ea580c] px-3 py-2 text-xs leading-5 text-white shadow-sm">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <ScoutMessageBubble
                  key={msg.id}
                  response={msg.response}
                  compact
                  onUpgrade={showUpgrade}
                />
              )
            )}

            {/* Typing indicator */}
            {isLoading && <CompactTypingIndicator />}

            {/* Error */}
            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            {/* Auto-scroll anchor */}
            <div ref={chatEndRef} />
          </div>

          {/* ── Session activity (shown only when entries exist) ── */}
          <ScoutActivityTimeline compact />

          {/* ── Input area (pinned at bottom) ── */}
          <div className="flex-shrink-0 bg-white p-3">
            {/* Suggestion chips — shown when not loading */}
            {!isLoading && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {suggestionChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => fillChip(chip)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition hover:border-[#ea580c]/20 hover:bg-[#ea580c]/5 hover:text-[#ea580c]"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            {/* Input */}
            <form onSubmit={handleSubmit}>
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition focus-within:border-slate-300 focus-within:bg-white">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={isLoading}
                  placeholder={hasConversation ? "Follow up…" : "Ask Scout…"}
                  className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || isLoading}
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#FF5C18] text-white transition hover:bg-[#E14F0E] disabled:opacity-40"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {/* ── Floating trigger button ── */}
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className={`pointer-events-auto inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(11,46,86,0.35)] transition ${
          isOpen
            ? "bg-[#0A2546] hover:bg-[#ea580c]"
            : "bg-[#0B2E56] hover:bg-[#0A2546]"
        }`}
      >
        <Sparkles className="h-4 w-4" />
        {isOpen ? "Close Scout" : "Ask Scout"}
        {hasConversation && !isOpen && (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#FF5C18] text-[9px] font-bold">
            {messages.filter((m) => m.role === "user").length}
          </span>
        )}
      </button>
    </div>
  )
}
