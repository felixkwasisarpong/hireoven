"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import { LayoutDashboard, Sparkles } from "lucide-react"
import { ScoutCommandBar } from "./ScoutCommandBar"
import { IdleMode } from "./IdleMode"
import { SearchMode } from "./SearchMode"
import { CompareMode } from "./CompareMode"
import { TailorMode } from "./TailorMode"
import { ApplicationMode } from "./ApplicationMode"
import { ContextRail } from "./ContextRail"
import { normalizeScoutResponse } from "@/lib/scout/normalize"
import { getScoutSuggestionChips } from "@/lib/scout/mode"
import { getScoutNudges } from "@/lib/scout/nudges"
import { detectScoutMode } from "@/lib/scout/mode"
import { inferWorkspaceMode, type WorkspaceMode, type WorkspaceRail } from "@/lib/scout/workspace"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useAuth } from "@/lib/hooks/useAuth"
import type { ScoutResponse, ScoutStrategyBoard } from "@/lib/scout/types"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"
import type { ScoutNudge } from "@/lib/scout/nudges"

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "scout"; response: ScoutResponse }

export function ScoutWorkspaceShell() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { primaryResume } = useResumeContext()
  const { user, profile } = useAuth()
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const prevResumeIdRef = useRef<string | null | undefined>(undefined)

  // ── Chat state ──────────────────────────────────────────────────────────────
  const [messages,   setMessages]   = useState<ChatMessage[]>([])
  const [query,      setQuery]      = useState("")
  const [isLoading,  setIsLoading]  = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [resumeRefreshedNotice, setResumeRefreshedNotice] = useState(false)

  // ── Workspace state ─────────────────────────────────────────────────────────
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("idle")
  const [activeResponse, setActiveResponse] = useState<ScoutResponse | null>(null)
  const [rail, setRail] = useState<WorkspaceRail | null>(null)
  const [chips, setChips] = useState<string[]>([])

  // ── Strategy / behavior data ────────────────────────────────────────────────
  const [strategyBoard,   setStrategyBoard]   = useState<ScoutStrategyBoard | null>(null)
  const [strategyLoading, setStrategyLoading] = useState(true)
  const [behaviorSignals, setBehaviorSignals] = useState<ScoutBehaviorSignals | null>(null)
  const [behaviorLoading, setBehaviorLoading] = useState(true)

  // ── Derived ─────────────────────────────────────────────────────────────────
  const scoutMode = detectScoutMode(pathname ?? "")
  const isFocusMode = searchParams.get("focus") === "1"

  const nudges: ScoutNudge[] = useMemo(() => {
    if (!strategyBoard || !behaviorSignals) return []
    return getScoutNudges(scoutMode, behaviorSignals, strategyBoard, {
      isFocusMode,
      resumeId: primaryResume?.id ?? null,
    })
  }, [strategyBoard, behaviorSignals, scoutMode, isFocusMode, primaryResume?.id])

  const contextIds = {
    jobId: searchParams.get("jobId") ?? undefined,
    companyId: searchParams.get("companyId") ?? undefined,
    resumeId: searchParams.get("resumeId") ?? undefined,
    applicationId: searchParams.get("applicationId") ?? undefined,
  }

  const fullName = profile?.full_name ?? user?.user_metadata?.full_name ?? null
  const firstName = fullName?.split(" ")[0] ?? "there"
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  // Populate chips from Scout mode suggestion list (updated on mount and when mode changes)
  useEffect(() => {
    setChips(getScoutSuggestionChips(scoutMode))
  }, [scoutMode])

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  useEffect(() => {
    const currentId = primaryResume?.id ?? null
    if (prevResumeIdRef.current !== undefined && prevResumeIdRef.current !== currentId) {
      setMessages([])
      setError(null)
      setActiveResponse(null)
      setWorkspaceMode("idle")
      setRail(null)
      setResumeRefreshedNotice(true)
      const t = setTimeout(() => setResumeRefreshedNotice(false), 5_000)
      return () => clearTimeout(t)
    }
    prevResumeIdRef.current = currentId
  }, [primaryResume?.id])

  useEffect(() => {
    function onReset() {
      setMessages([])
      setError(null)
      setActiveResponse(null)
      setWorkspaceMode("idle")
      setRail(null)
    }
    window.addEventListener("scout:reset-context", onReset)
    return () => window.removeEventListener("scout:reset-context", onReset)
  }, [])

  // Load strategy board
  useEffect(() => {
    let cancelled = false
    setStrategyLoading(true)
    fetch("/api/scout/strategy", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { board?: ScoutStrategyBoard } | undefined
        if (!cancelled) setStrategyBoard(data?.board ?? null)
      })
      .catch(() => { if (!cancelled) setStrategyBoard(null) })
      .finally(() => { if (!cancelled) setStrategyLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Load behavior signals
  useEffect(() => {
    let cancelled = false
    setBehaviorLoading(true)
    fetch("/api/scout/behavior", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { signals?: ScoutBehaviorSignals | null } | undefined
        if (!cancelled) setBehaviorSignals(data?.signals ?? null)
      })
      .catch(() => { if (!cancelled) setBehaviorSignals(null) })
      .finally(() => { if (!cancelled) setBehaviorLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Submit handler ───────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
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
            pagePath: pathname,
            commandMode: true,
            focusMode: isFocusMode,
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

        setMessages((prev) => [
          ...prev,
          { id: `s-${Date.now()}`, role: "scout", response: normalized },
        ])

        // Infer workspace mode from response
        const newMode = inferWorkspaceMode(normalized)
        setWorkspaceMode(newMode)
        setActiveResponse(normalized)

        // Build context rail from meaningful actions
        const railActions = normalized.actions?.filter(
          (a) => ["OPEN_JOB", "OPEN_COMPANY", "OPEN_RESUME_TAILOR"].includes(a.type)
        )
        if (railActions && railActions.length > 0) {
          setRail({
            title: "Scout actions",
            summary: "Suggested next steps from Scout",
            actions: railActions,
          })
        } else {
          setRail(null)
        }

        // Update suggestion chips from Scout response if provided
        // (future: normalized.chips; for now keep current chips)
      } catch {
        setError("Network error. Please check your connection.")
      } finally {
        setIsLoading(false)
      }
    },
    [query, isLoading, pathname, isFocusMode, searchParams, contextIds]
  )

  function handleChipClick(chip: string) {
    setQuery(chip)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function handleFollowUp(text: string) {
    setQuery(text)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  function handleClearChat() {
    setMessages([])
    setError(null)
    setActiveResponse(null)
    setWorkspaceMode("idle")
    setRail(null)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">

      {/* ── Command bar — sticky ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-gray-100 bg-white px-5 py-5 sm:px-8">

        {/* Logo row */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 rounded-xl bg-[#FF5C18]/30 blur-md" />
              <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_12px_rgba(255,92,24,0.4)]">
                <Sparkles className="h-4 w-4 text-white" />
              </span>
            </div>
            <div>
              <p className="text-sm font-bold leading-none text-gray-950">Scout</p>
              <p className="mt-0.5 text-[10px] text-gray-400">AI job search workspace</p>
            </div>
          </div>

          {/* Mode indicator + advanced link */}
          <div className="flex items-center gap-3">
            {workspaceMode !== "idle" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]" />
                {workspaceMode}
              </span>
            )}
            <Link
              href="/dashboard/scout/legacy"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-400 transition hover:text-gray-700"
              title="Open classic Scout dashboard"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Advanced
            </Link>
          </div>
        </div>

        <ScoutCommandBar
          query={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          isLoading={isLoading}
          chips={chips}
          onChipClick={handleChipClick}
          inputRef={inputRef}
          placeholder={
            workspaceMode === "idle"
              ? "Ask Scout anything…"
              : workspaceMode === "search"
                ? "Refine this search…"
                : workspaceMode === "compare"
                  ? "Ask about this comparison…"
                  : "Follow up with Scout…"
          }
        />
      </div>

      {/* ── Workspace ────────────────────────────────────────────────────── */}
      <div className="app-shell flex w-full max-w-6xl gap-6 py-7 pb-16">

        {/* Main workspace area */}
        <div className="min-w-0 flex-1">
          <div
            key={workspaceMode}
            className="animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            {workspaceMode === "idle" && (
              <IdleMode
                greeting={greeting}
                firstName={firstName}
                messages={messages}
                isLoading={isLoading}
                error={error}
                nudges={nudges}
                strategyLoading={strategyLoading || behaviorLoading}
                resumeRefreshedNotice={resumeRefreshedNotice}
                onClearChat={handleClearChat}
                chatEndRef={chatEndRef as React.RefObject<HTMLDivElement>}
              />
            )}

            {workspaceMode === "search" && activeResponse && (
              <SearchMode
                response={activeResponse}
                onFollowUp={handleFollowUp}
              />
            )}

            {workspaceMode === "compare" && activeResponse && (
              <CompareMode
                response={activeResponse}
                onFollowUp={handleFollowUp}
              />
            )}

            {workspaceMode === "tailor" && activeResponse && (
              <TailorMode
                response={activeResponse}
                onFollowUp={handleFollowUp}
              />
            )}

            {workspaceMode === "applications" && activeResponse && (
              <ApplicationMode
                response={activeResponse}
                onFollowUp={handleFollowUp}
              />
            )}
          </div>
        </div>

        {/* Context rail — slides in when Scout provides actions */}
        {rail && (
          <div className="hidden animate-in fade-in slide-in-from-right-4 duration-200 lg:block">
            <ContextRail
              rail={rail}
              onClose={() => setRail(null)}
            />
          </div>
        )}
      </div>
    </main>
  )
}
