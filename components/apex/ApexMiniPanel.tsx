"use client"

import { useMemo, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { Loader2, RefreshCw, Send, Sparkles, X, SlidersHorizontal, Star, MessageSquare } from "lucide-react"
import Image from "next/image"

const LOADER_GIF = "/hireoven_clean_loader_160.gif"
import { ScoutMessageBubble } from "@/components/scout/ScoutMessageBubble"
import { ScoutActivityTimeline } from "@/components/scout/ScoutActivityTimeline"
import { ScoutContextChip } from "@/components/scout/ScoutContextChip"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useScoutActionExecutor } from "@/components/scout/useScoutActionExecutor"
import { normalizeScoutResponse } from "@/lib/scout/normalize"
import { cn } from "@/lib/utils"
import type { ScoutAction, ScoutResponse } from "@/lib/scout/types"

type MiniTask = {
  title: string
  description: string
  prompt: string
  icon: typeof SlidersHorizontal
}

const MINI_TASKS: MiniTask[] = [
  {
    title: "Adjust Preferences",
    description: "Fine-tune your current job search criteria.",
    prompt: "Show my current preferences and tighten filters for my target roles.",
    icon: SlidersHorizontal,
  },
  {
    title: "Top Match Jobs",
    description: "Explore roles where you are a strong fit.",
    prompt: "Show jobs worth my time and prioritize top matches.",
    icon: Star,
  },
  {
    title: "Ask Scout",
    description: "Get detailed insights on specific jobs.",
    prompt: "Show this job's match score, location, sponsorship signal, and salary if available.",
    icon: MessageSquare,
  },
]

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
      <Image src={LOADER_GIF} alt="" width={28} height={28} unoptimized className="mt-0.5 flex-shrink-0" />
    </div>
  )
}

function sanitizeMiniResponse(response: ScoutResponse): ScoutResponse {
  if (!response.gated) return response
  return {
    ...response,
    answer: "I can help with free tasks here: adjust preferences, surface top matches, and explain specific jobs.",
    gated: undefined,
  }
}

function isMiniAutoAction(action: ScoutAction): boolean {
  return (
    action.type === "APPLY_FILTERS" ||
    action.type === "SET_FOCUS_MODE" ||
    action.type === "RESET_CONTEXT"
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
  const { primaryResume } = useResumeContext()
  const { executeAction } = useScoutActionExecutor()

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
    () => ({ jobId, companyId, resumeId, applicationId }),
    [applicationId, companyId, jobId, resumeId]
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

  async function sendMessage(message: string) {
    const trimmed = message.trim()
    if (!trimmed || isLoading) return

    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: trimmed }])
    setQuery("")
    setIsLoading(true)
    setError(null)

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    try {
      const controller = new AbortController()
      timeoutId = setTimeout(() => controller.abort(), 25000)

      const res = await fetch("/api/scout/chat", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        signal: controller.signal,
        // Read URL filters at send-time so the panel stays in sync without useSearchParams.
        // This avoids route-level CSR deopts from client search param hooks.
        body: JSON.stringify({
          ...(function resolveRequestContext() {
            const params =
              typeof window === "undefined"
                ? new URLSearchParams()
                : new URLSearchParams(window.location.search)

            return {
              focusMode: params.get("focus") === "1",
              activeFilters: {
                q: params.get("q") ?? undefined,
                location: params.get("location") ?? undefined,
                sponsorship: params.get("sponsorship") ?? undefined,
                workMode: params.get("workMode") ?? undefined,
              },
              jobId: contextIds.jobId ?? params.get("jobId") ?? undefined,
              companyId: contextIds.companyId ?? params.get("companyId") ?? undefined,
              resumeId: contextIds.resumeId ?? params.get("resumeId") ?? undefined,
              applicationId: contextIds.applicationId ?? params.get("applicationId") ?? undefined,
            }
          })(),
          message: trimmed,
          pagePath: resolvedPagePath,
          source: "mini",
        }),
      })

      const raw = (await res.json().catch(() => null)) as unknown
      const rawObj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null

      // The server can return non-2xx with a fully-formed ScoutResponse body.
      // In MiniScout we still render a normal response message.
      const looksLikeScoutResponse =
        rawObj !== null && typeof rawObj.answer === "string" && rawObj.answer.length > 0

      if (!res.ok && !looksLikeScoutResponse) {
        const errMsg = rawObj && "error" in rawObj
          ? String(rawObj.error)
          : "Scout could not respond right now."
        setError(errMsg)
        return
      }

      const normalized = sanitizeMiniResponse(normalizeScoutResponse(raw))
      const autoActions = normalized.actions.filter(isMiniAutoAction)
      for (const action of autoActions) {
        executeAction(action, {
          source: "chat",
          reason: "Mini Scout quick task",
        })
      }
      const visibleResponse =
        autoActions.length > 0
          ? { ...normalized, actions: normalized.actions.filter((a) => !isMiniAutoAction(a)) }
          : normalized
      setMessages((prev) => [...prev, { id: `s-${Date.now()}`, role: "scout", response: visibleResponse }])
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Scout took too long to respond. Try again.")
      } else {
        setError("Network error. Please try again.")
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    await sendMessage(query)
  }

  // Capability and suggestion chips fire the message immediately — users expect a
  // tap to submit, not a two-step fill-then-press-Send.
  function runChip(chip: string) {
    void sendMessage(chip)
  }

  const hasConversation = messages.length > 0
  const userTurns = messages.filter((m) => m.role === "user").length

  return (
    <div className="pointer-events-none fixed bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)+4.5rem))] right-4 z-[55] flex flex-col items-end gap-3 md:bottom-6 md:right-6">

      {/* ── Panel ───────────────────────────────────────────── */}
      {isOpen && (
        <section
          className="pointer-events-auto flex w-[min(92vw,360px)] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_20px_60px_rgba(15,23,42,0.20),0_0_0_1px_rgba(15,23,42,0.07)]"
          style={{ maxHeight: "min(72vh,520px)" }}
        >
          {/* ── Header ── */}
          <div className="flex flex-shrink-0 items-center gap-3 bg-[#FF5C18] px-4 py-3.5">
            {/* Avatar */}
            <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/20 ring-2 ring-white/30">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/hireoven-icon.svg" alt="" className="h-5 w-5" draggable={false} />
            </span>

            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold leading-none text-white">Scout</p>
              <p className="mt-0.5 text-[10.5px] leading-none text-white/70">Your AI job-search copilot</p>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close Scout"
              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── Message area ── */}
          <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4 py-4 space-y-3">

            {/* Resume refreshed notice */}
            {resumeRefreshedNotice && (
              <div className="flex items-center gap-2 rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-xs text-orange-700">
                <RefreshCw className="h-3 w-3 flex-shrink-0" />
                Scout refreshed context for your updated resume.
              </div>
            )}

            {/* Greeting + action chips (empty state) */}
            {!hasConversation && !isLoading && (
              <>
                {/* Timestamp */}
                <p className="text-center text-[10px] text-gray-400">
                  {new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </p>

                {/* Scout greeting bubble */}
                <div className="flex items-start gap-2.5">
                  <Image src={LOADER_GIF} alt="" width={28} height={28} unoptimized className="mt-0.5 flex-shrink-0" />
                  <div className="rounded-2xl rounded-tl-sm bg-gray-100 px-3.5 py-2.5 text-[13px] leading-5 text-gray-800">
                    Hi there! I&apos;m Scout, your AI job-search copilot. Tell me what you&apos;re working on — I&apos;ll handle the rest.
                  </div>
                </div>

                {/* Context chip */}
                <div className="pl-9">
                  <ScoutContextChip onReset={() => setMessages([])} />
                </div>

                {/* Action chips — Clara-style stacked pills */}
                <div className="pl-9 space-y-2">
                  {(suggestionChips.length > 0 ? suggestionChips : MINI_TASKS.map((t) => t.title)).map((chip, i) => {
                    const prompt = suggestionChips.length > 0
                      ? chip
                      : (MINI_TASKS[i]?.prompt ?? chip)
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => runChip(prompt)}
                        className="flex w-full items-center gap-2 rounded-full bg-[#FF5C18] px-4 py-2 text-left text-[12px] font-semibold text-white transition hover:bg-[#E14F0E] active:scale-[0.98]"
                      >
                        <Sparkles className="h-3 w-3 flex-shrink-0 opacity-75" />
                        {chip}
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {/* Conversation context chip */}
            {hasConversation && (
              <ScoutContextChip onReset={() => setMessages([])} />
            )}

            {/* Messages */}
            {messages.map((msg) =>
              msg.role === "user" ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-[#FF5C18] px-3.5 py-2.5 text-[13px] leading-5 text-white">
                    {msg.text}
                  </div>
                </div>
              ) : (
                <ScoutMessageBubble
                  key={msg.id}
                  response={msg.response}
                  context="mini"
                  compact
                />
              )
            )}

            {isLoading && <TypingIndicator />}

            {error && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                {error}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* ── Input area ── */}
          <div className="flex-shrink-0 border-t border-gray-100 bg-white px-3 py-2.5">
            <form onSubmit={handleSubmit}>
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  disabled={isLoading}
                  placeholder="Enter a message"
                  className="w-full bg-transparent text-[13px] text-gray-800 outline-none placeholder:text-gray-400"
                />
                <button
                  type="submit"
                  disabled={!query.trim() || isLoading}
                  aria-label="Send"
                  className="flex-shrink-0 text-[#FF5C18] transition hover:text-[#E14F0E] disabled:opacity-30"
                >
                  {isLoading
                    ? <Loader2 className="h-5 w-5 animate-spin" />
                    : <Send className="h-5 w-5" />
                  }
                </button>
              </div>
            </form>
          </div>

          {/* ── Footer ── */}
          <div className="flex-shrink-0 bg-white px-4 pb-3 pt-0">
            <p className="text-[10px] leading-4 text-gray-400">
              By chatting you agree to our{" "}
              <span className="underline cursor-pointer hover:text-gray-600">privacy policy</span>
              {" "}and{" "}
              <span className="underline cursor-pointer hover:text-gray-600">terms of service</span>.
            </p>
          </div>
        </section>
      )}

      {/* ── Floating trigger ─────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label={isOpen ? "Close Scout" : "Open Scout"}
        className="pointer-events-auto relative inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[#FF5C18] shadow-[0_4px_20px_rgba(255,92,24,0.45)] transition-all duration-200 hover:bg-[#E14F0E] hover:scale-105 hover:shadow-[0_6px_28px_rgba(255,92,24,0.55)] active:scale-95"
      >
        {isOpen
          ? <X className="h-5 w-5 text-white" />
          : <Sparkles className="h-5 w-5 text-white" />
        }

        {/* Unread badge */}
        {hasConversation && !isOpen && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-white text-[8px] font-bold text-[#FF5C18]">
            {userTurns}
          </span>
        )}
      </button>
    </div>
  )
}
