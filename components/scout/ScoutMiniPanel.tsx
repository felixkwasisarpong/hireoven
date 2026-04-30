"use client"

import { useMemo, useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react"
import { ScoutMessageBubble } from "@/components/scout/ScoutMessageBubble"
import { ScoutActivityTimeline } from "@/components/scout/ScoutActivityTimeline"
import { ScoutContextChip } from "@/components/scout/ScoutContextChip"
import { ScoutChatbotAnimation } from "@/components/scout/ScoutChatbotAnimation"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { normalizeScoutResponse } from "@/lib/scout/normalize"
import { cn } from "@/lib/utils"
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

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.3)]">
        <ScoutChatbotAnimation />
      </span>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-4 py-3 shadow-sm">
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]/50 animate-bounce"
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

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 80)
  }, [isOpen])

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

  useEffect(() => {
    function onReset() { setMessages([]); setError(null) }
    window.addEventListener("scout:reset-context", onReset)
    return () => window.removeEventListener("scout:reset-context", onReset)
  }, [])

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

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: message }])
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
          typeof raw === "object" && raw !== null && "error" in (raw as Record<string, unknown>)
            ? String((raw as Record<string, unknown>).error)
            : "Scout could not respond right now."
        setError(errMsg)
        return
      }

      const normalized = normalizeScoutResponse(raw)
      setMessages((prev) => [...prev, { id: `s-${Date.now()}`, role: "scout", response: normalized }])
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
  const userTurns = messages.filter((m) => m.role === "user").length

  return (
    <div className="pointer-events-none fixed bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)+4.5rem))] right-4 z-[55] flex flex-col items-end gap-3 md:bottom-6 md:right-6">

      {/* ── Panel ───────────────────────────────────────────── */}
      {isOpen && (
        <section
          className="pointer-events-auto flex w-[min(95vw,28rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_72px_rgba(15,23,42,0.22),0_0_0_1px_rgba(15,23,42,0.06)]"
          style={{ maxHeight: "min(80vh,640px)" }}
        >
          {/* ── Header ── */}
          <div className="relative flex-shrink-0 overflow-hidden bg-slate-950 px-4 py-4">
            {/* Subtle orange glow behind avatar */}
            <div className="pointer-events-none absolute left-4 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full bg-[#FF5C18]/25 blur-xl" />

            <div className="relative flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Glowing Scout avatar */}
                <div className="relative flex-shrink-0">
                  <div className="absolute inset-0 rounded-xl bg-[#FF5C18]/40 blur-md" />
                  <span className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-[#FF5C18] shadow-[0_4px_16px_rgba(255,92,24,0.5)]">
                    <ScoutChatbotAnimation />
                  </span>
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-white">Scout</p>
                    {hasConversation && (
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#FF5C18] text-[9px] font-bold text-white">
                        {userTurns}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400">AI job search assistant</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close Scout"
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Message area ── */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-[#F5F6F8] p-4 space-y-3">
            {/* Resume refreshed notice */}
            {resumeRefreshedNotice && (
              <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <RefreshCw className="h-3.5 w-3.5 flex-shrink-0" />
                Scout refreshed context for your updated resume.
              </div>
            )}

            {/* Empty state */}
            {!hasConversation && !isLoading && (
              <div className="flex flex-col items-center px-2 py-6 text-center">
                {/* Glowing avatar */}
                <div className="relative mb-4">
                  <div className="absolute inset-0 scale-150 rounded-3xl bg-[#FF5C18]/15 blur-2xl" />
                  <div className="relative inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-[#FF5C18] shadow-[0_8px_28px_rgba(255,92,24,0.4)]">
                    <ScoutChatbotAnimation className="scale-[1.06]" />
                  </div>
                </div>

                <p className="text-base font-bold text-gray-900">How can I help?</p>
                <p className="mt-1 text-[11px] text-gray-400 leading-5">
                  Ask anything about this page, job, or your search
                </p>

                {/* Context chip */}
                <div className="mt-4 w-full">
                  <ScoutContextChip onReset={() => setMessages([])} />
                </div>

                {/* Suggestion cards */}
                {suggestionChips.length > 0 && (
                  <div className="mt-4 w-full space-y-2">
                    {suggestionChips.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => fillChip(chip)}
                        className="group flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-700 shadow-sm transition hover:border-[#FF5C18]/30 hover:bg-[#FFF8F5] hover:text-[#FF5C18]"
                      >
                        <span>{chip}</span>
                        <span className="text-gray-300 transition group-hover:text-[#FF5C18]/60">→</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Conversation context chip — small, when chatting */}
            {hasConversation && (
              <ScoutContextChip onReset={() => setMessages([])} />
            )}

            {/* Messages */}
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[82%] rounded-2xl rounded-tr-sm bg-[#FF5C18] px-3.5 py-2.5 text-xs leading-5 text-white shadow-[0_4px_12px_rgba(255,92,24,0.25)]">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <ScoutMessageBubble
                  key={msg.id}
                  response={msg.response}
                  context="mini"
                  compact
                  onUpgrade={showUpgrade}
                />
              )
            )}

            {isLoading && <TypingIndicator />}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                {error}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ── Session activity ── */}
          <ScoutActivityTimeline compact />

          {/* ── Input area ── */}
          <div className="flex-shrink-0 border-t border-gray-100 bg-white p-3">
            {/* Suggestion chips — compact, when already chatting */}
            {!isLoading && hasConversation && suggestionChips.length > 0 && (
              <div className="mb-2.5 flex flex-wrap gap-1.5">
                {suggestionChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => fillChip(chip)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 transition hover:border-[#FF5C18]/30 hover:bg-[#FFF8F5] hover:text-[#FF5C18]"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className={cn(
                "flex items-center gap-2 rounded-xl border-2 bg-white px-3 py-2 transition",
                "border-gray-200 focus-within:border-[#FF5C18]/40 focus-within:shadow-[0_0_0_3px_rgba(255,92,24,0.07)]"
              )}>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={isLoading}
                  placeholder={hasConversation ? "Follow up…" : "Ask Scout anything…"}
                  className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || isLoading}
                  className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#FF5C18] text-white shadow-[0_4px_12px_rgba(255,92,24,0.3)] transition hover:bg-[#E14F0E] hover:shadow-[0_4px_16px_rgba(255,92,24,0.4)] disabled:opacity-40 disabled:shadow-none"
                >
                  {isLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </form>
          </div>
        </section>
      )}

      {/* ── Floating trigger button ──────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={cn(
          "pointer-events-auto relative inline-flex items-center gap-2.5 rounded-full px-5 py-3 text-sm font-bold text-white transition-all duration-200",
          isOpen
            ? "bg-slate-800 shadow-[0_8px_24px_rgba(15,23,42,0.3)] hover:bg-slate-700"
            : "bg-slate-950 shadow-[0_8px_32px_rgba(15,23,42,0.4)] hover:bg-slate-800"
        )}
      >
        {/* Idle pulse ring */}
        {!isOpen && !hasConversation && (
          <span className="absolute inset-0 rounded-full animate-ping bg-slate-800/60 duration-1000" />
        )}

        <Sparkles
          className={cn(
            "h-4 w-4 transition-colors",
            isOpen ? "text-slate-400" : "text-[#FF5C18]"
          )}
        />
        <span>{isOpen ? "Close" : "Scout"}</span>

        {/* Unread badge */}
        {hasConversation && !isOpen && (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#FF5C18] text-[9px] font-bold">
            {userTurns}
          </span>
        )}
      </button>
    </div>
  )
}
