"use client"

import { BarChart2, BookOpen, Clock, Home, TrendingUp, Zap } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useUpgradeModal } from "@/lib/context/UpgradeModalContext"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useAuth } from "@/lib/hooks/useAuth"
import { detectScoutMode, getScoutSuggestionChips } from "@/lib/scout/mode"
import { normalizeScoutResponse } from "@/lib/scout/normalize"
import { getScoutNudges } from "@/lib/scout/nudges"
import type {
  ScoutCompareResponse,
  ScoutInterviewPrep,
  ScoutResponse,
  ScoutStrategyBoard,
} from "@/lib/scout/types"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"

import { ScoutOverviewTab } from "@/components/scout/tabs/ScoutOverviewTab"
import { ScoutStrategyTab } from "@/components/scout/tabs/ScoutStrategyTab"
import { ScoutActionsTab } from "@/components/scout/tabs/ScoutActionsTab"
import { ScoutCompareTab } from "@/components/scout/tabs/ScoutCompareTab"
import { ScoutInterviewPrepTab } from "@/components/scout/tabs/ScoutInterviewPrepTab"
import { ScoutActivityTab } from "@/components/scout/tabs/ScoutActivityTab"

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "overview" | "strategy" | "actions" | "compare" | "interview-prep" | "activity"

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "scout"; response: ScoutResponse }

const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
  { id: "overview",       label: "Overview",       Icon: Home },
  { id: "strategy",       label: "Strategy",       Icon: TrendingUp },
  { id: "actions",        label: "Actions",        Icon: Zap },
  { id: "compare",        label: "Compare",        Icon: BarChart2 },
  { id: "interview-prep", label: "Interview Prep", Icon: BookOpen },
  { id: "activity",       label: "Activity",       Icon: Clock },
]

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ScoutPage() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { showUpgrade } = useUpgradeModal()
  const { primaryResume } = useResumeContext()
  const { user, profile } = useAuth()
  const chatEndRef = useRef<HTMLDivElement>(null)
  const prevResumeIdRef = useRef<string | null | undefined>(undefined)

  const [activeTab, setActiveTab] = useState<Tab>("overview")
  const [isCommandMode, setIsCommandMode] = useState(true)
  const [query, setQuery] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [resumeRefreshedNotice, setResumeRefreshedNotice] = useState(false)
  const [compareLoading, setCompareLoading] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)
  const [strategyBoard, setStrategyBoard] = useState<ScoutStrategyBoard | null>(null)
  const [strategyLoading, setStrategyLoading] = useState(true)
  const [strategyError, setStrategyError] = useState<string | null>(null)
  const [behaviorSignals, setBehaviorSignals] = useState<ScoutBehaviorSignals | null>(null)
  const [behaviorLoading, setBehaviorLoading] = useState(true)

  const mode = detectScoutMode(pathname ?? "")
  const isFocusMode = searchParams.get("focus") === "1"

  const nudges = useMemo(() => {
    if (!strategyBoard || !behaviorSignals) return []
    return getScoutNudges(mode, behaviorSignals, strategyBoard, {
      isFocusMode,
      resumeId: primaryResume?.id ?? null,
    })
  }, [strategyBoard, behaviorSignals, mode, isFocusMode, primaryResume?.id])

  const contextIds = {
    jobId: searchParams.get("jobId") ?? undefined,
    companyId: searchParams.get("companyId") ?? undefined,
    resumeId: searchParams.get("resumeId") ?? undefined,
    applicationId: searchParams.get("applicationId") ?? undefined,
  }

  const suggestionChips = getScoutSuggestionChips(mode)
  const hasConversation = messages.length > 0
  const userTurns = messages.filter((m) => m.role === "user").length

  const fullName = profile?.full_name ?? user?.user_metadata?.full_name ?? null
  const firstName = fullName?.split(" ")[0] ?? "there"
  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  // ── Derived last responses ─────────────────────────────────────────────────

  const lastCompareResponse = useMemo<ScoutCompareResponse | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "scout" && m.response.compare) return m.response.compare
    }
    return null
  }, [messages])

  const lastInterviewPrepResponse = useMemo<ScoutInterviewPrep | null>(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "scout" && m.response.interviewPrep) return m.response.interviewPrep
    }
    return null
  }, [messages])

  const lastWorkflowResponse = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "scout" && m.response.workflow) return m.response.workflow
    }
    return null
  }, [messages])

  const lastActionsResponse = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === "scout" && m.response.actions?.length) return m.response.actions
    }
    return null
  }, [messages])

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

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
    function onReset() {
      setMessages([])
      setError(null)
    }
    window.addEventListener("scout:reset-context", onReset)
    return () => window.removeEventListener("scout:reset-context", onReset)
  }, [])

  useEffect(() => {
    let cancelled = false
    setStrategyLoading(true)
    setStrategyError(null)
    fetch("/api/scout/strategy", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as
          | { board?: ScoutStrategyBoard; error?: string }
          | undefined
        if (!res.ok) throw new Error(data?.error ?? "Failed to load strategy board")
        if (!cancelled) setStrategyBoard(data?.board ?? null)
      })
      .catch((err) => {
        if (!cancelled)
          setStrategyError(err instanceof Error ? err.message : "Failed to load strategy board")
      })
      .finally(() => { if (!cancelled) setStrategyLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setBehaviorLoading(true)
    fetch("/api/scout/behavior", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as
          | { signals?: ScoutBehaviorSignals | null }
          | undefined
        if (!cancelled) setBehaviorSignals(data?.signals ?? null)
      })
      .catch(() => { if (!cancelled) setBehaviorSignals(null) })
      .finally(() => { if (!cancelled) setBehaviorLoading(false) })
    return () => { cancelled = true }
  }, [])

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedQuery = query.trim()
    if (!trimmedQuery || isLoading) return

    setActiveTab("overview")
    setMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", text: trimmedQuery },
    ])
    setQuery("")
    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch("/api/scout/chat", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedQuery,
          pagePath: pathname,
          commandMode: isCommandMode,
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
            : "Failed to get response from Scout"
        setError(errMsg)
        return
      }

      const normalized = normalizeScoutResponse(raw)
      setMessages((prev) => [
        ...prev,
        { id: `s-${Date.now()}`, role: "scout", response: normalized },
      ])

      if (normalized.compare) setActiveTab("compare")
      else if (normalized.interviewPrep) setActiveTab("interview-prep")
    } catch {
      setError("Network error. Please check your connection and try again.")
    } finally {
      setIsLoading(false)
    }
  }

  function fillChip(chip: string) {
    setQuery(chip)
    setActiveTab("overview")
  }

  /** Run a Scout command scoped to a specific tab — does not redirect. */
  async function runScoutCommand(message: string, tab: Tab) {
    if (compareLoading || isLoading) return
    setCompareLoading(true)
    setCompareError(null)

    try {
      const res = await fetch("/api/scout/chat", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          pagePath: pathname,
          commandMode: true,
          focusMode: false,
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
            : "Scout couldn't run that command right now."
        setCompareError(errMsg)
        return
      }

      const normalized = normalizeScoutResponse(raw)
      // Add to shared messages — lastCompareResponse / lastInterviewPrepResponse
      // memos pick it up automatically, keeping the active tab unchanged.
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}-cmd`, role: "user", text: message },
        { id: `s-${Date.now()}-cmd`, role: "scout", response: normalized },
      ])
    } catch {
      setCompareError("Network error. Please check your connection and try again.")
    } finally {
      setCompareLoading(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="app-page">

      {/* ── Tab bar ── */}
      <div className="border-b border-slate-200/90 bg-white">
        <div className="overflow-x-auto scrollbar-none">
          <nav aria-label="Scout sections" className="flex items-stretch gap-0 px-4 sm:px-7">
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id
              const hasDot =
                (id === "compare" && lastCompareResponse !== null) ||
                (id === "interview-prep" && lastInterviewPrepResponse !== null) ||
                (id === "actions" &&
                  (lastWorkflowResponse !== null || lastActionsResponse !== null))
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  aria-current={active ? "page" : undefined}
                  className={`group relative flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[13px] font-medium transition-colors sm:px-4 ${
                    active
                      ? "border-[#ea580c] bg-[#ea580c]/[0.04] text-[#ea580c]"
                      : "border-transparent text-slate-600 hover:bg-slate-50/80 hover:text-slate-900"
                  }`}
                >
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 hidden h-5 w-0.5 -translate-y-1/2 rounded-full bg-[#ea580c] sm:block"
                      aria-hidden
                    />
                  )}
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                      active
                        ? "border-[#ea580c]/20 bg-white text-[#ea580c]"
                        : "border-slate-200/80 bg-slate-50 text-slate-500 group-hover:border-slate-300 group-hover:text-slate-700"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  {label}
                  {hasDot && !active && (
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="app-shell w-full max-w-3xl py-6 pb-12">
        {activeTab === "overview" && (
          <ScoutOverviewTab
            greeting={greeting}
            firstName={firstName}
            query={query}
            setQuery={setQuery}
            isLoading={isLoading}
            isCommandMode={isCommandMode}
            setIsCommandMode={setIsCommandMode}
            suggestionChips={suggestionChips}
            messages={messages}
            error={error}
            resumeRefreshedNotice={resumeRefreshedNotice}
            strategyBoard={strategyBoard}
            strategyLoading={strategyLoading}
            nudges={nudges}
            hasConversation={hasConversation}
            userTurns={userTurns}
            onSubmit={handleSubmit}
            onFillChip={fillChip}
            onClearChat={() => { setMessages([]); setError(null) }}
            onResetContext={() => { setMessages([]); setError(null) }}
            onViewStrategy={() => setActiveTab("strategy")}
          />
        )}

        {activeTab === "strategy" && (
          <ScoutStrategyTab
            board={strategyBoard}
            isLoading={strategyLoading}
            error={strategyError}
            behaviorSignals={behaviorSignals}
            behaviorLoading={behaviorLoading}
          />
        )}

        {activeTab === "actions" && (
          <ScoutActionsTab
            lastWorkflowResponse={lastWorkflowResponse}
            lastActionsResponse={lastActionsResponse}
            onFillChip={fillChip}
          />
        )}

        {activeTab === "compare" && (
          <ScoutCompareTab
            compareResponse={lastCompareResponse}
            onRunCompareCommand={(msg) => runScoutCommand(msg, "compare")}
            isLoading={compareLoading}
            error={compareError}
          />
        )}

        {activeTab === "interview-prep" && (
          <ScoutInterviewPrepTab
            interviewPrep={lastInterviewPrepResponse}
            onFillChip={fillChip}
          />
        )}

        {activeTab === "activity" && <ScoutActivityTab />}
      </div>
    </main>
  )
}
