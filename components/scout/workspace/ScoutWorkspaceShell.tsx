"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import { LayoutDashboard, Shield, Sparkles, X } from "lucide-react"
import { ScoutCommandBar } from "./ScoutCommandBar"
import { WorkspaceSurface } from "./WorkspaceSurface"
import { IdleMode } from "./IdleMode"
import { SearchMode } from "./SearchMode"
import { CompareMode } from "./CompareMode"
import { TailorMode } from "./TailorMode"
import { ApplicationMode } from "./ApplicationMode"
import { ContextRail } from "./ContextRail"
import { ScoutCommandPalette } from "./ScoutCommandPalette"
import { normalizeScoutResponse } from "@/lib/scout/normalize"
import { useWorkflowEngine } from "@/lib/scout/workflows/engine"
import { WorkflowPanel } from "@/components/scout/workflows/WorkflowPanel"
import { useActiveBrowserContext } from "@/lib/scout/browser-context"
import { getContextualChips, getContextualPlaceholder } from "@/lib/scout/context-chips"
import { writePinnedContext } from "@/lib/scout/pinned-context"
import { BrowserContextRail } from "@/components/scout/workspace/BrowserContextRail"
import {
  readSearchProfile,
  writeSearchProfile,
  clearSearchProfile,
  mergeProfileUpdate,
  extractProfileUpdate,
  buildMemoryChips,
  type ScoutSearchProfile,
} from "@/lib/scout/search-profile"
import { ScoutMemoryChips } from "@/components/scout/ScoutMemoryChips"
import { getPersonalizedChips } from "@/lib/scout/mode"
import { ScoutMarketRail } from "@/components/scout/ScoutMarketRail"
import type { MarketSignal } from "@/lib/scout/market-intelligence"
import { ScoutActionGate } from "@/components/scout/ScoutActionGate"
import { ScoutPermissionsPanel } from "@/components/scout/ScoutPermissionsPanel"
import { readPermissions, type ScoutPermissionState } from "@/lib/scout/permissions"
import { getScoutSuggestionChips } from "@/lib/scout/mode"
import { getScoutNudges } from "@/lib/scout/nudges"
import { detectScoutMode } from "@/lib/scout/mode"
import { inferWorkspaceMode, type WorkspaceMode, type WorkspaceRail } from "@/lib/scout/workspace"
import {
  appendCommand,
  clearScoutSession,
  extractModeMetadata,
  extractRailMetadata,
  readScoutSession,
  writeScoutSession,
} from "@/lib/scout/session"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useAuth } from "@/lib/hooks/useAuth"
import type { ScoutResponse, ScoutStrategyBoard } from "@/lib/scout/types"
import type { ScoutBehaviorSignals } from "@/lib/scout/behavior"
import type { ScoutNudge } from "@/lib/scout/nudges"
import { cn } from "@/lib/utils"

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "scout"; response: ScoutResponse }

/** Entities carried across workspace mode transitions */
export type ActiveEntities = {
  jobId?: string
  jobTitle?: string
  companyId?: string
  companyName?: string
}

/** Extract safe entity identifiers from a Scout response (no text content). */
function extractEntities(
  response: ScoutResponse,
  current: ActiveEntities
): ActiveEntities {
  const next: ActiveEntities = { ...current }

  for (const action of response.actions ?? []) {
    if (action.type === "OPEN_JOB") next.jobId = action.payload.jobId
    if (action.type === "OPEN_COMPANY") next.companyId = action.payload.companyId
  }

  // Compare mode: use the winner or first item as the active job
  if (response.compare?.winnerJobId) {
    next.jobId = response.compare.winnerJobId
    const winner = response.compare.items.find(
      (i) => i.jobId === response.compare!.winnerJobId
    )
    if (winner) {
      if (winner.title)   next.jobTitle   = winner.title
      if (winner.company) next.companyName = winner.company
      if (winner.companyId) next.companyId = winner.companyId ?? undefined
    }
  }

  return next
}

/** Derive a short Scout narrative string from a response. */
function buildNarrative(mode: WorkspaceMode, response: ScoutResponse): string {
  const answer = response.answer?.trim()
  if (!answer || /^\s*[{[]/.test(answer)) {
    // JSON blob leaked — synthesise a generic strip
    const labels: Record<WorkspaceMode, string> = {
      search:       "Scout prepared a filtered job search.",
      compare:      "Scout compared your saved roles.",
      tailor:       "Scout identified tailoring opportunities.",
      applications: "Scout prepared a workflow plan.",
      idle:         "",
    }
    return labels[mode] ?? ""
  }
  // Trim to one sentence / 140 chars for the strip
  const sentence = answer.split(/\.[\s\n]/)[0]
  return sentence.length <= 140 ? sentence : `${sentence.slice(0, 137)}…`
}

// ─────────────────────────────────────────────────────────────────────────────

export function ScoutWorkspaceShell() {
  const pathname   = usePathname()
  const searchParams = useSearchParams()
  const { primaryResume } = useResumeContext()
  const { user, profile } = useAuth()
  const chatEndRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const prevResumeIdRef = useRef<string | null | undefined>(undefined)

  // ── Workflow engine ─────────────────────────────────────────────────────────
  const workflowEngine = useWorkflowEngine()

  // ── Active browser context (from extension) ─────────────────────────────────
  const { context: browserContext } = useActiveBrowserContext()

  // ── Search profile (persistent lightweight memory) ──────────────────────────
  const [searchProfile, setSearchProfile] = useState<ScoutSearchProfile | null>(null)

  // ── Market intelligence signals ─────────────────────────────────────────────
  const [marketSignals,   setMarketSignals]   = useState<MarketSignal[]>([])
  const [marketLoading,   setMarketLoading]   = useState(true)

  // ── Permission gate (shell-level — handles events from any executor) ─────────
  const [activeGate,        setActiveGate]        = useState<import("@/components/scout/ScoutActionGate").GateRequest | null>(null)
  const [showPermissions,   setShowPermissions]   = useState(false)
  const [shellPermissions,  setShellPermissions]  = useState<ScoutPermissionState[]>(() => readPermissions())

  // ── Chat state ──────────────────────────────────────────────────────────────
  const [messages,  setMessages]  = useState<ChatMessage[]>([])
  const [query,     setQuery]     = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [resumeRefreshedNotice, setResumeRefreshedNotice] = useState(false)

  // ── Workspace state ─────────────────────────────────────────────────────────
  const [workspaceMode,   setWorkspaceMode]   = useState<WorkspaceMode>("idle")
  const [activeResponse,  setActiveResponse]  = useState<ScoutResponse | null>(null)
  const [rail,            setRail]            = useState<WorkspaceRail | null>(null)
  const [chips,           setChips]           = useState<string[]>([])
  const [activeEntities,  setActiveEntities]  = useState<ActiveEntities>({})
  const [narrative,        setNarrative]        = useState<string>("")
  const [narrativeDismissed, setNarrativeDismissed] = useState(false)
  const [paletteOpen,      setPaletteOpen]      = useState(false)

  // ── Session state ───────────────────────────────────────────────────────────
  const [recentCommands, setRecentCommands] = useState<string[]>([])
  const [hasSession,     setHasSession]     = useState(false)

  // ── Strategy / behavior data ────────────────────────────────────────────────
  const [strategyBoard,   setStrategyBoard]   = useState<ScoutStrategyBoard | null>(null)
  const [strategyLoading, setStrategyLoading] = useState(true)
  const [behaviorSignals, setBehaviorSignals] = useState<ScoutBehaviorSignals | null>(null)
  const [behaviorLoading, setBehaviorLoading] = useState(true)

  // ── Derived ─────────────────────────────────────────────────────────────────
  const scoutMode   = detectScoutMode(pathname ?? "")
  const isFocusMode = searchParams.get("focus") === "1"

  const nudges: ScoutNudge[] = useMemo(() => {
    if (!strategyBoard || !behaviorSignals) return []
    return getScoutNudges(scoutMode, behaviorSignals, strategyBoard, {
      isFocusMode,
      resumeId: primaryResume?.id ?? null,
    })
  }, [strategyBoard, behaviorSignals, scoutMode, isFocusMode, primaryResume?.id])

  const contextIds = {
    jobId:         searchParams.get("jobId")         ?? undefined,
    companyId:     searchParams.get("companyId")     ?? undefined,
    resumeId:      searchParams.get("resumeId")      ?? undefined,
    applicationId: searchParams.get("applicationId") ?? undefined,
  }

  const fullName  = profile?.full_name ?? user?.user_metadata?.full_name ?? null
  const firstName = fullName?.split(" ")[0] ?? "there"
  const hour      = new Date().getHours()
  const greeting  = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"

  // ── Gate event bus — listens for permission requests from any executor ────────
  useEffect(() => {
    function onGateOpen(e: Event) {
      const detail = (e as CustomEvent).detail
      setActiveGate(detail)
    }
    window.addEventListener("scout:gate-open", onGateOpen)
    return () => window.removeEventListener("scout:gate-open", onGateOpen)
  }, [])

  function dispatchGateResponse(approved: boolean, alwaysAllow = false) {
    setActiveGate(null)
    window.dispatchEvent(new CustomEvent("scout:gate-response", {
      detail: { approved, alwaysAllow },
    }))
  }

  // ── Load search profile on mount + listen for memory-cleared events ──────────
  useEffect(() => {
    setSearchProfile(readSearchProfile())

    function onMemoryCleared() {
      clearSearchProfile()
      setSearchProfile(null)
    }
    window.addEventListener("scout:memory-cleared", onMemoryCleared)
    return () => window.removeEventListener("scout:memory-cleared", onMemoryCleared)
  }, [])

  // ── Pin browser context to sessionStorage so workflows can read it ───────────
  useEffect(() => {
    if (!browserContext || browserContext.pageType === "unknown") return
    writePinnedContext({
      company:    browserContext.company,
      jobTitle:   browserContext.title,
      ats:        browserContext.atsProvider,
      pageUrl:    browserContext.url,
      jobId:      browserContext.detectedJobId,
    })
  }, [browserContext])

  // ── Adaptive chips — extension context > search profile > session > defaults ──
  const displayChips = useMemo(() => {
    if (workspaceMode === "idle" && !hasSession) {
      // Browser context (active job/search page) takes highest priority
      if (browserContext) {
        const ctxChips = getContextualChips(browserContext)
        if (ctxChips) return ctxChips
      }
      // Search profile personalization as fallback
      const personalChips = getPersonalizedChips(scoutMode, searchProfile)
      if (personalChips.length > 0) return personalChips
    }
    return chips
  }, [workspaceMode, hasSession, browserContext, searchProfile, scoutMode, chips])

  // ── Adaptive command bar placeholder ────────────────────────────────────────
  const commandBarPlaceholder = useMemo(() => {
    if (workspaceMode !== "idle") {
      if (workspaceMode === "search")  return "Refine this search…"
      if (workspaceMode === "compare") return "Ask about this comparison…"
      return "Follow up with Scout…"
    }
    return getContextualPlaceholder(
      browserContext,
      "Ask Scout anything…  (/ or ⌘K for commands)",
    )
  }, [workspaceMode, browserContext])

  // ── Session restore ─────────────────────────────────────────────────────────
  useEffect(() => {
    const session = readScoutSession()
    if (!session) { setChips(getScoutSuggestionChips(scoutMode)); return }
    setHasSession(true)
    setWorkspaceMode(session.mode)
    setRecentCommands(session.recentCommands)
    setChips(session.chips.length > 0 ? session.chips : getScoutSuggestionChips(scoutMode))
    if (session.rail) setRail({ title: session.rail.title, summary: session.rail.summary })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hasSession) setChips(getScoutSuggestionChips(scoutMode))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoutMode])

  // ── Effects ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, isLoading])

  useEffect(() => {
    const currentId = primaryResume?.id ?? null
    if (prevResumeIdRef.current !== undefined && prevResumeIdRef.current !== currentId) {
      setMessages([]); setError(null); setActiveResponse(null)
      setWorkspaceMode("idle"); setRail(null); setNarrative("")
      setActiveEntities({})
      setResumeRefreshedNotice(true)
      const t = setTimeout(() => setResumeRefreshedNotice(false), 5_000)
      return () => clearTimeout(t)
    }
    prevResumeIdRef.current = currentId
  }, [primaryResume?.id])

  useEffect(() => {
    function onReset() {
      clearScoutSession()
      setMessages([]); setError(null); setActiveResponse(null)
      setWorkspaceMode("idle"); setRail(null); setNarrative("")
      setActiveEntities({}); setRecentCommands([]); setHasSession(false)
    }
    window.addEventListener("scout:reset-context", onReset)
    return () => window.removeEventListener("scout:reset-context", onReset)
  }, [])

  // Global Cmd+K / Ctrl+K → open command palette
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

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

  useEffect(() => {
    let cancelled = false
    setMarketLoading(true)
    fetch("/api/scout/market", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { signals?: MarketSignal[] } | undefined
        if (!cancelled) setMarketSignals(data?.signals ?? [])
      })
      .catch(() => { if (!cancelled) setMarketSignals([]) })
      .finally(() => { if (!cancelled) setMarketLoading(false) })
    return () => { cancelled = true }
  }, [])

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

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (event: React.FormEvent, overrideMessage?: string) => {
      event.preventDefault()
      const message = (overrideMessage ?? query).trim()
      if (!message || isLoading) return

      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: message }])
      setQuery("")
      setIsLoading(true)
      setError(null)
      setNarrative("")
      setNarrativeDismissed(false)

      try {
        const res = await fetch("/api/scout/chat", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            message, pagePath: pathname, commandMode: true, focusMode: isFocusMode,
            activeFilters: {
              q: searchParams.get("q") ?? undefined, location: searchParams.get("location") ?? undefined,
              sponsorship: searchParams.get("sponsorship") ?? undefined, workMode: searchParams.get("workMode") ?? undefined,
            },
            ...contextIds,
            ...(searchProfile ? { searchProfile } : {}),
          }),
        })

        const raw = (await res.json().catch(() => null)) as unknown
        if (!res.ok) {
          const errMsg = typeof raw === "object" && raw !== null && "error" in (raw as Record<string, unknown>)
            ? String((raw as Record<string, unknown>).error) : "Scout could not respond right now."
          setError(errMsg); return
        }

        const normalized = normalizeScoutResponse(raw)
        setMessages((prev) => [...prev, { id: `s-${Date.now()}`, role: "scout", response: normalized }])
        setActiveResponse(normalized)

        // Mode
        const directive = normalized.workspace_directive
        const newMode   = directive?.mode ?? inferWorkspaceMode(normalized)
        setWorkspaceMode(newMode)

        // Narrative strip
        if (newMode !== "idle") {
          setNarrative(buildNarrative(newMode, normalized))
        }

        // Active entities — carry through transitions
        setActiveEntities((prev) => extractEntities(normalized, prev))

        // Search profile — extract preferences from this interaction
        const profileUpdate = extractProfileUpdate(normalized, message)
        if (Object.keys(profileUpdate).length > 0) {
          setSearchProfile((prev) => {
            const updated = mergeProfileUpdate(prev, profileUpdate)
            writeSearchProfile(updated)
            return updated
          })
        }

        // Workflow — start panel if Scout returns a workflow_directive
        if (normalized.workflow_directive) {
          workflowEngine.startWorkflow(
            normalized.workflow_directive.workflowType,
            normalized.workflow_directive.payload
          )
        }

        // Rail
        let newRail: WorkspaceRail | null = null
        if (directive?.rail !== undefined) {
          newRail = directive.rail ?? null
        } else {
          const railActions = normalized.actions?.filter(
            (a) => ["OPEN_JOB", "OPEN_COMPANY", "OPEN_RESUME_TAILOR"].includes(a.type)
          )
          newRail = railActions?.length
            ? { title: "Scout context", summary: "Suggested next steps", actions: railActions }
            : null
        }
        setRail(newRail)

        // Chips
        const newChips = directive?.chips?.length ? directive.chips : chips
        if (directive?.chips?.length) setChips(directive.chips)

        // Session
        const updatedCommands = appendCommand(recentCommands, message)
        setRecentCommands(updatedCommands)
        setHasSession(true)
        writeScoutSession({
          mode: newMode, chips: newChips, recentCommands: updatedCommands,
          rail: extractRailMetadata(newRail), modeMetadata: extractModeMetadata(newMode, normalized),
        })
      } catch {
        setError("Network error. Please check your connection.")
      } finally {
        setIsLoading(false)
      }
    },
    [query, isLoading, pathname, isFocusMode, searchParams, contextIds, chips, recentCommands]
  )

  function handleChipClick(chip: string) { setQuery(chip); setTimeout(() => inputRef.current?.focus(), 50) }
  function handleFollowUp(text: string)  { setQuery(text); setTimeout(() => inputRef.current?.focus(), 50) }
  function handleSendCommand(query: string) { setQuery(query); setTimeout(() => inputRef.current?.focus(), 50) }

  function handleClearChat() {
    setMessages([]); setError(null); setActiveResponse(null)
    setWorkspaceMode("idle"); setRail(null); setNarrative(""); setActiveEntities({})
  }

  function handleStartFresh() {
    clearScoutSession()
    setMessages([]); setError(null); setActiveResponse(null)
    setWorkspaceMode("idle"); setRail(null); setNarrative(""); setActiveEntities({})
    setRecentCommands([]); setHasSession(false); setChips(getScoutSuggestionChips(scoutMode))
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const showNarrative = narrative && !narrativeDismissed && workspaceMode !== "idle"

  return (
    <main className="app-page pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))]">

      {/* ── Command bar — dark, sticky ─────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-slate-950 px-5 sm:px-8">
        <div className="flex items-center justify-between pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="relative flex-shrink-0">
              <div className="absolute inset-0 rounded-xl bg-[#FF5C18]/40 blur-md" />
              <span className="relative inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#FF5C18] shadow-[0_4px_14px_rgba(255,92,24,0.5)]">
                <Sparkles className="h-4 w-4 text-white" />
              </span>
            </div>
            <div>
              <p className="text-sm font-bold leading-none text-white">Scout</p>
              <p className="mt-0.5 text-[10px] text-slate-400">AI job search workspace</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {workspaceMode !== "idle" && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]" />
                {workspaceMode}
              </span>
            )}
            {/* Permissions button */}
            <button
              type="button"
              onClick={() => setShowPermissions(true)}
              title="Scout permissions"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 transition hover:text-slate-300"
            >
              <Shield className="h-3.5 w-3.5" />
            </button>
            <Link
              href="/dashboard/scout/legacy"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 transition hover:text-slate-300"
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              Advanced
            </Link>
          </div>
        </div>

        <ScoutCommandBar
          query={query} onChange={setQuery} onSubmit={handleSubmit}
          isLoading={isLoading} chips={displayChips} onChipClick={handleChipClick}
          inputRef={inputRef} variant="dark" commandHistory={recentCommands}
          onOpenPalette={() => setPaletteOpen(true)}
          placeholder={commandBarPlaceholder}
        />
        <div className="h-5" />
      </div>

      {/* ── Workspace ─────────────────────────────────────────────────── */}
      <div className="app-shell flex w-full max-w-6xl gap-6 py-6 pb-16">

        {/* Main surface — no key remounting, CSS fade-through */}
        <div className="min-w-0 flex-1">

          {/* Scout narrative strip */}
          {showNarrative && (
            <div className="mb-5 flex items-start gap-3 border-l-2 border-[#FF5C18] bg-white px-4 py-3">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-[#FF5C18]" />
              <p className="flex-1 text-sm leading-5 text-gray-700">{narrative}</p>
              <button
                type="button"
                onClick={() => setNarrativeDismissed(true)}
                className="flex-shrink-0 text-gray-400 transition hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Scout learned — lightweight memory chips, idle only */}
          {workspaceMode === "idle" && searchProfile && (() => {
            const memChips = buildMemoryChips(searchProfile)
            if (!memChips.length) return null
            return (
              <div className="mb-4">
                <ScoutMemoryChips
                  chips={memChips}
                  onDismiss={(fieldKey) => {
                    setSearchProfile((prev) => {
                      if (!prev) return prev
                      const updated = { ...prev, [fieldKey]: undefined, updatedAt: new Date().toISOString() }
                      writeSearchProfile(updated)
                      return updated
                    })
                  }}
                  onClearAll={() => {
                    window.dispatchEvent(new CustomEvent("scout:memory-cleared"))
                  }}
                />
              </div>
            )
          })()}

          {/* WorkspaceSurface — smooth opacity fade between modes */}
          <WorkspaceSurface
            mode={workspaceMode}
            render={(displayedMode) => {
              if (displayedMode === "idle") {
                return (
                  <IdleMode
                    greeting={greeting} firstName={firstName} messages={messages}
                    isLoading={isLoading} error={error} nudges={nudges}
                    strategyLoading={strategyLoading || behaviorLoading}
                    resumeRefreshedNotice={resumeRefreshedNotice}
                    onClearChat={handleClearChat}
                    onTileClick={(q) => { setQuery(q); setTimeout(() => inputRef.current?.focus(), 50) }}
                    chatEndRef={chatEndRef as React.RefObject<HTMLDivElement>}
                    recentCommands={recentCommands} hasSession={hasSession}
                    onStartFresh={handleStartFresh}
                  />
                )
              }
              if (displayedMode === "search" && activeResponse) {
                return (
                  <SearchMode
                    response={activeResponse} onFollowUp={handleFollowUp}
                    activeEntities={activeEntities}
                  />
                )
              }
              if (displayedMode === "compare" && activeResponse) {
                return (
                  <CompareMode
                    response={activeResponse} onFollowUp={handleFollowUp}
                    activeEntities={activeEntities}
                  />
                )
              }
              if (displayedMode === "tailor" && activeResponse) {
                return (
                  <TailorMode
                    response={activeResponse} onFollowUp={handleFollowUp}
                    activeEntities={activeEntities}
                  />
                )
              }
              if (displayedMode === "applications" && activeResponse) {
                return (
                  <ApplicationMode
                    response={activeResponse} onFollowUp={handleFollowUp}
                    activeEntities={activeEntities}
                  />
                )
              }
              // Fallback for restored session with no activeResponse
              return null
            }}
          />
        </div>

        {/* Right intelligence rail — Scout rail > browser context > market signals */}
        {(rail || (browserContext && browserContext.pageType !== "unknown") || marketSignals.length > 0) && (
          <div className="hidden lg:flex flex-col gap-4 transition-all duration-200 opacity-100 translate-x-0">
            {rail ? (
              <ContextRail rail={rail} onClose={() => setRail(null)} />
            ) : browserContext && browserContext.pageType !== "unknown" ? (
              <BrowserContextRail
                context={browserContext}
                activeWorkflow={workflowEngine.activeWorkflow}
                onPreFill={handleSendCommand}
                onExpandWorkflow={() => workflowEngine.setExpanded(true)}
              />
            ) : null}

            {/* Market signals — show in idle mode when there's space */}
            {workspaceMode === "idle" && (marketSignals.length > 0 || marketLoading) && (
              <ScoutMarketRail signals={marketSignals} loading={marketLoading} />
            )}
          </div>
        )}
      </div>
      {/* ── Command palette ──────────────────────────────────────────── */}
      <ScoutCommandPalette
        isOpen={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        workspaceMode={workspaceMode}
        onSelect={(paletteQuery, autoRun) => {
          if (autoRun) {
            // Submit directly — bypass query state to avoid timing issue
            setQuery("")
            const fakeEvent = { preventDefault: () => {} } as React.FormEvent
            void handleSubmit(fakeEvent, paletteQuery)
          } else {
            // Fill the bar for user to review before submitting
            setQuery(paletteQuery)
            setTimeout(() => inputRef.current?.focus(), 50)
          }
        }}
      />

      {/* ── Workflow panel — floats bottom-right, non-intrusive ──────── */}
      <WorkflowPanel
        activeWorkflow={workflowEngine.activeWorkflow}
        continueStep={workflowEngine.continueStep}
        skipStep={workflowEngine.skipStep}
        pauseWorkflow={workflowEngine.pauseWorkflow}
        resumeWorkflow={workflowEngine.resumeWorkflow}
        cancelWorkflow={workflowEngine.cancelWorkflow}
        isExpanded={workflowEngine.isExpanded}
        setExpanded={workflowEngine.setExpanded}
      />

      {/* ── Permission gate — bottom-center, not a modal ────────────── */}
      {activeGate && (
        <ScoutActionGate
          gate={activeGate}
          onAllowOnce={() => dispatchGateResponse(true, false)}
          onAlwaysAllow={() => dispatchGateResponse(true, true)}
          onCancel={() => dispatchGateResponse(false)}
        />
      )}

      {/* ── Permissions panel — bottom-right slide-in ───────────────── */}
      {showPermissions && (
        <ScoutPermissionsPanel
          permissions={shellPermissions}
          onPermissionsChange={setShellPermissions}
          onClose={() => setShowPermissions(false)}
        />
      )}
    </main>
  )
}
