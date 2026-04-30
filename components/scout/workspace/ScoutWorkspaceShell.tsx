"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Clock, LayoutDashboard, Mic, PanelBottomOpen, Shield, Sparkles, X } from "lucide-react"
import { ScoutCommandBar } from "./ScoutCommandBar"
import { WorkspaceSurface } from "./WorkspaceSurface"
import { IdleMode } from "./IdleMode"
import { SearchMode } from "./SearchMode"
import { CompareMode } from "./CompareMode"
import { TailorMode } from "./TailorMode"
import { ApplicationMode } from "./ApplicationMode"
import { BulkApplicationMode } from "./BulkApplicationMode"
import { CompanyMode } from "./CompanyMode"
import { BulkConfirmDialog } from "@/components/scout/bulk/BulkConfirmDialog"
import { BulkReviewDrawer } from "@/components/scout/bulk/BulkReviewDrawer"
import { ContextRail } from "./ContextRail"
import { CompanyIntelRail } from "@/components/scout/CompanyIntelRail"
import { ScoutCommandPalette } from "./ScoutCommandPalette"
import { useWorkflowEngine } from "@/lib/scout/workflows/engine"
import { useBulkApplicationEngine } from "@/lib/scout/bulk-application/engine"
import { useScoutStream } from "@/hooks/useScoutStream"
import { useResearchStream } from "@/hooks/useResearchStream"
import { detectPreflightMode, PREFLIGHT_NARRATIVE } from "@/lib/scout/streaming/intent-preflight"
import { isResearchIntent } from "@/lib/scout/research/tasks"
import { writeResearchTask, readResearchTask } from "@/lib/scout/research/store"
import { ResearchMode } from "./ResearchMode"
import { OutreachMode } from "./OutreachMode"
import { InterviewPrepMode } from "./InterviewPrepMode"
import { CareerStrategyMode } from "./CareerStrategyMode"
import { isCareerStrategyIntent } from "@/lib/scout/career/intent"
import { useCareerStrategy } from "@/hooks/useCareerStrategy"
import { useScoutBrowserOperator } from "@/hooks/useScoutBrowserOperator"
import { BrowserActionStrip } from "./BrowserActionStrip"
import { useScoutTimeline } from "@/hooks/useScoutTimeline"
import { ScoutTimelinePanel } from "@/components/scout/timeline/ScoutTimelinePanel"
import { useScoutProactive } from "@/hooks/useScoutProactive"
import { ScoutProactiveStrip } from "@/components/scout/proactive/ScoutProactiveStrip"
import { ScoutProactiveRail } from "@/components/scout/proactive/ScoutProactiveRail"
import type {
  ScoutTimelineEvent,
  ScoutTimelineReplayAction,
} from "@/lib/scout/timeline/types"
import type { ScoutProactiveEvent } from "@/lib/scout/proactive/types"
import type { ScoutResearchTask } from "@/lib/scout/research/types"
import { generateDailyMissions, buildMomentumLine } from "@/lib/scout/missions/generator"
import {
  readMissionStore,
  writeMissionStore,
  patchMissionStatus,
  setMissionsDisabled,
} from "@/lib/scout/missions/store"
import type { ScoutMissionStore } from "@/lib/scout/missions/types"
import { WorkflowPanel } from "@/components/scout/workflows/WorkflowPanel"
import { useActiveBrowserContext } from "@/lib/scout/browser-context"
import { getContextualChips, getContextualPlaceholder } from "@/lib/scout/context-chips"
import { writePinnedContext } from "@/lib/scout/pinned-context"
import { BrowserContextRail } from "@/components/scout/workspace/BrowserContextRail"
import { MobileContextSheet } from "@/components/scout/workspace/MobileContextSheet"
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
import { ScoutContinuationStrip } from "@/components/scout/continuation/ScoutContinuationStrip"
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
import type { OutcomeLearningResult } from "@/lib/scout/outcomes/types"
import { useScoutContinuation } from "@/hooks/useScoutContinuation"
import { mergeResumableContexts } from "@/lib/scout/continuation/sanitize"
import type { ScoutResumableContext } from "@/lib/scout/continuation/types"
import { cn } from "@/lib/utils"

type ChatMessage =
  | { id: string; role: "user";           text: string }
  | { id: string; role: "scout";          response: ScoutResponse }
  | { id: string; role: "scout_streaming"; streamText: string }

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
    const labels: Record<WorkspaceMode, string> = {
      search:            "Scout prepared a filtered job search.",
      compare:           "Scout compared your saved roles.",
      tailor:            "Scout identified tailoring opportunities.",
      applications:      "Scout prepared a workflow plan.",
      bulk_application:  "Scout is preparing your bulk application queue.",
      company:           "Scout surfaced company intelligence.",
      research:          "Scout is running your research task.",
      outreach:          "Scout prepared your outreach draft.",
      interview:         "Scout generated your interview prep plan.",
      career_strategy:   "Scout analysed your career profile and directions.",
      idle:              "",
    }
    return labels[mode] ?? ""
  }
  const sentence = answer.split(/\.[\s\n]/)[0]
  return sentence.length <= 140 ? sentence : `${sentence.slice(0, 137)}…`
}

type TimelineSignalDetail = Partial<Omit<ScoutTimelineEvent, "id" | "timestamp">> & {
  timestamp?: string
}

function queueStatusLabel(status: string): string {
  switch (status) {
    case "pending": return "Queued"
    case "preparing": return "Preparing"
    case "ready": return "Ready"
    case "needs_review": return "Needs review"
    case "failed": return "Failed"
    case "skipped": return "Skipped"
    case "submitted": return "Submitted"
    default: return status
  }
}

function proactiveCommandSuggestion(event: ScoutProactiveEvent): string {
  switch (event.type) {
    case "new_match":
      return "Show me the new high-match jobs and rank them by fit"
    case "sponsorship_signal":
      return "Show sponsorship-friendly roles matching my profile"
    case "stale_saved_job":
      return "Review my stale saved roles and recommend the best next action"
    case "workflow_reminder":
      return "Resume my paused workflow and show the next step"
    case "application_followup":
      return "Which applications need follow-up this week?"
    case "interview_reminder":
      return "Prepare me for my upcoming interview"
    case "market_shift":
      return "Explain this market shift and how I should adjust my search"
    case "company_activity":
      return "Show company hiring activity and roles worth prioritizing"
    case "skill_signal":
      return "Help me close the top skill gap in my strongest matches"
    case "queue_ready":
      return "Open my prepared application queue for review"
    default:
      return "What should I prioritize next?"
  }
}

function continuationContextKey(context: ScoutResumableContext): string {
  return `${context.type}:${context.id}`
}

function openContinuationPrompt(context: ScoutResumableContext): string {
  switch (context.type) {
    case "workflow":
      return `Resume ${context.title}?`
    case "compare":
      return `Continue ${context.title.toLowerCase()}?`
    case "tailor":
      return `Continue tailoring for ${context.title}?`
    case "research":
      return `${context.title} is still available.`
    case "application_queue":
      return `${context.title} is ready for review.`
    default:
      return context.title
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const IS_DEV = process.env.NODE_ENV === "development"

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

  // ── Bulk application engine ─────────────────────────────────────────────────
  const bulkEngine = useBulkApplicationEngine()

  // ── Scout streaming ─────────────────────────────────────────────────────────
  const scoutStream    = useScoutStream()
  const streamMsgId    = useRef<string | null>(null)

  // Refs for timeline change detection (avoid duplicate event emission)
  const prevModeRef          = useRef<WorkspaceMode>("idle")
  const prevWorkflowIdRef    = useRef<string | null>(null)
  const prevWorkflowStepRef  = useRef<string | null>(null)
  const prevBrowserCtxKey    = useRef<string | null>(null)
  const prevResolvedJobIdRef = useRef<string | null>(null)
  const prevResearchIdRef    = useRef<string | null>(null)
  const prevFindingCountRef  = useRef<number>(0)
  const prevGateKeyRef       = useRef<string | null>(null)
  const prevQueueIdRef       = useRef<string | null>(null)
  const prevQueueStatusRef   = useRef<Record<string, string>>({})
  const prevQueueCompletedAtRef = useRef<string | null>(null)
  const commandStartedAtRef  = useRef<number | null>(null)
  const lastCommandLatencyRef = useRef<number | null>(null)
  const lastDebugRef = useRef<ScoutResponse["debug"] | null>(null)

  // ── Research streaming ──────────────────────────────────────────────────────
  const researchStream = useResearchStream()

  // ── Career strategy ─────────────────────────────────────────────────────────
  const careerStrategy = useCareerStrategy()

  // ── Activity timeline ───────────────────────────────────────────────────────
  const timeline       = useScoutTimeline()
  const [showTimeline, setShowTimeline] = useState(false)
  const [showMobileContext, setShowMobileContext] = useState(false)
  // Restored research task — used by session replay when research mode is re-entered
  const [restoredResearchTask, setRestoredResearchTask] = useState<ScoutResearchTask | null>(null)

  // ── Active browser context (from extension) ─────────────────────────────────
  const { context: browserContext, isExtensionConnected } = useActiveBrowserContext()

  // ── Search profile (persistent lightweight memory) ──────────────────────────
  const [searchProfile, setSearchProfile] = useState<ScoutSearchProfile | null>(null)

  // ── Market intelligence signals ─────────────────────────────────────────────
  const [marketSignals,   setMarketSignals]   = useState<MarketSignal[]>([])
  const [marketLoading,   setMarketLoading]   = useState(true)

  // ── Permission gate (shell-level — handles events from any executor) ─────────
  const [activeGate,        setActiveGate]        = useState<import("@/components/scout/ScoutActionGate").GateRequest | null>(null)
  const [showPermissions,   setShowPermissions]   = useState(false)
  const [shellPermissions,  setShellPermissions]  = useState<ScoutPermissionState[]>(() => readPermissions())

  // ── Browser operator — must be after browserContext, isExtensionConnected, shellPermissions ──
  const operator = useScoutBrowserOperator({
    permissions:          shellPermissions,
    browserContext,
    isExtensionConnected,
    onTimelineEvent: ({ type, title, summary, severity }) => {
      timeline.append({
        type,
        title,
        summary,
        severity: severity ?? "info",
        timestamp: new Date().toISOString(),
      })
    },
  })

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
  const [dismissedContinuationIds, setDismissedContinuationIds] = useState<Set<string>>(new Set())

  // ── Strategy / behavior data ────────────────────────────────────────────────
  const [strategyBoard,   setStrategyBoard]   = useState<ScoutStrategyBoard | null>(null)
  const [strategyLoading, setStrategyLoading] = useState(true)
  const [behaviorSignals, setBehaviorSignals] = useState<ScoutBehaviorSignals | null>(null)
  const [behaviorLoading, setBehaviorLoading] = useState(true)
  const [outcomeLearning, setOutcomeLearning] = useState<OutcomeLearningResult | null>(null)

  // ── Daily missions ──────────────────────────────────────────────────────────
  const [missionStore, setMissionStore] = useState<ScoutMissionStore | null>(null)

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
  // Compute greeting client-side only — server UTC hour differs from client local
  // hour causing a text content hydration mismatch.
  const [greeting, setGreeting] = useState("Good morning")
  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening")
  }, [])

  const proactive = useScoutProactive({
    marketSignals,
    outcomeLearning,
    searchProfile,
    behaviorSignals,
    activeWorkflow: workflowEngine.activeWorkflow,
    bulkQueue: bulkEngine.queue,
  })

  const continuation = useScoutContinuation()

  // ── Gate event bus — listens for permission requests from any executor ────────
  useEffect(() => {
    function onGateOpen(e: Event) {
      const detail = (e as CustomEvent).detail
      setActiveGate(detail)
    }
    window.addEventListener("scout:gate-open", onGateOpen)
    return () => window.removeEventListener("scout:gate-open", onGateOpen)
  }, [])

  // ── Extension review-submitted bridge ────────────────────────────────────────
  // When the user clicks "Mark submitted" in the extension Final Review panel,
  // it posts hireoven:review-submitted to the page. We update the queue here.
  useEffect(() => {
    function onReviewSubmitted(e: MessageEvent) {
      if (e.data?.type !== "hireoven:review-submitted") return
      const jobId = e.data?.jobId as string | undefined
      if (jobId) {
        // Find matching queue item by jobId and mark it submitted
        bulkEngine.queue?.jobs.forEach((j) => {
          if (j.jobId === jobId) bulkEngine.markSubmitted(j.queueId)
        })
      }
      timeline.append({
        type: "manual_submit",
        title: "Extension handoff marked as submitted",
        summary: jobId ? `Job ID: ${jobId}` : "Submission confirmation received from extension review panel.",
        timestamp: new Date().toISOString(),
        severity: "info",
      })
    }
    window.addEventListener("message", onReviewSubmitted)
    return () => window.removeEventListener("message", onReviewSubmitted)
  }, [bulkEngine, timeline.append])

  // ── External timeline signals ───────────────────────────────────────────────
  // Child components can emit lightweight timeline-safe events through this bus.
  useEffect(() => {
    function onTimelineSignal(e: Event) {
      const detail = (e as CustomEvent<TimelineSignalDetail>).detail
      if (!detail || typeof detail !== "object") return
      if (typeof detail.type !== "string") return
      if (typeof detail.title !== "string" || !detail.title.trim()) return

      timeline.append({
        type: detail.type as ScoutTimelineEvent["type"],
        title: detail.title,
        summary: typeof detail.summary === "string" ? detail.summary : undefined,
        timestamp: detail.timestamp ?? new Date().toISOString(),
        severity: detail.severity ?? "info",
        replayable: detail.replayable,
        replayAction: detail.replayAction,
        metadata: IS_DEV ? detail.metadata : undefined,
      })
    }

    window.addEventListener("scout:timeline-signal", onTimelineSignal as EventListener)
    return () => window.removeEventListener("scout:timeline-signal", onTimelineSignal as EventListener)
  }, [timeline.append])

  // ── Scout action audit bridge → timeline ───────────────────────────────────
  useEffect(() => {
    function onActionRecorded(e: Event) {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail
      const actionType = typeof detail?.actionType === "string" ? detail.actionType : null
      const label = typeof detail?.label === "string" ? detail.label : null
      if (!actionType || !label) return

      let type: ScoutTimelineEvent["type"] = "workflow_step"
      if (actionType === "OPEN_EXTENSION_AUTOFILL_PREVIEW") type = "autofill_reviewed"
      if (actionType === "APPLY_FILTERS" || actionType === "SET_FOCUS_MODE" || actionType === "RESET_CONTEXT") {
        type = "workspace_change"
      }

      timeline.append({
        type,
        title: label,
        summary: typeof detail.newStateSummary === "string" ? detail.newStateSummary : undefined,
        timestamp: new Date().toISOString(),
        severity: "info",
        metadata: IS_DEV
          ? {
              actionType,
              source: detail.source,
              previousStateSummary: detail.previousStateSummary,
              debugOnly: true,
            }
          : undefined,
      })
    }

    window.addEventListener("scout:action-recorded", onActionRecorded as EventListener)
    return () => window.removeEventListener("scout:action-recorded", onActionRecorded as EventListener)
  }, [timeline.append])

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

  const proactiveChip = useMemo(
    () => (proactive.topEvent ? proactiveCommandSuggestion(proactive.topEvent) : null),
    [proactive.topEvent]
  )

  // ── Adaptive chips — extension context > search profile > session > defaults ──
  const displayChips = useMemo(() => {
    let base = chips

    if (workspaceMode === "idle" && !hasSession) {
      // Browser context (active job/search page) takes highest priority
      if (browserContext) {
        const ctxChips = getContextualChips(browserContext)
        if (ctxChips) base = ctxChips
      }
      // Search profile personalization as fallback
      if (base === chips) {
        const personalChips = getPersonalizedChips(scoutMode, searchProfile)
        if (personalChips.length > 0) base = personalChips
      }
    }

    if (query.trim().length > 0 || !proactiveChip) return base
    if (base.includes(proactiveChip)) return base
    return [proactiveChip, ...base].slice(0, 5)
  }, [workspaceMode, hasSession, browserContext, searchProfile, scoutMode, chips, proactiveChip, query])

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

  const latestRailEvents = useMemo(
    () =>
      timeline.events
        .filter((event) =>
          ["command", "workflow_started", "workflow_step", "autofill_reviewed", "manual_submit", "error"].includes(event.type)
        )
        .slice(0, 6),
    [timeline.events]
  )

  const proactiveRailEvents = useMemo(
    () => proactive.visibleEvents.slice(0, 3),
    [proactive.visibleEvents]
  )

  const generatedResumableContexts = useMemo<ScoutResumableContext[]>(() => {
    const nowIso = new Date().toISOString()
    const contexts: ScoutResumableContext[] = []

    const wf = workflowEngine.activeWorkflow
    if (wf) {
      contexts.push({
        type: "workflow",
        id: wf.id,
        title: wf.title,
        updatedAt: wf.completedAt ?? wf.pausedAt ?? nowIso,
      })
    }

    const compare = activeResponse?.compare
    if (compare && compare.items.length > 0) {
      const first = compare.items[0]
      contexts.push({
        type: "compare",
        id: `compare:${compare.winnerJobId ?? first.jobId}`,
        title: `Comparing ${compare.items.length} role${compare.items.length !== 1 ? "s" : ""}`,
        updatedAt: nowIso,
      })
    }

    if (workspaceMode === "tailor" && (activeEntities.jobId || activeEntities.companyId)) {
      contexts.push({
        type: "tailor",
        id: activeEntities.jobId ?? activeEntities.companyId ?? "tailor",
        title: activeEntities.jobTitle ?? activeEntities.companyName ?? "Resume tailoring",
        updatedAt: nowIso,
      })
    }

    const researchTask = researchStream.task ?? restoredResearchTask
    if (researchTask && researchTask.status !== "failed") {
      contexts.push({
        type: "research",
        id: researchTask.id,
        title: researchTask.title,
        updatedAt: researchTask.updatedAt ?? researchTask.createdAt ?? nowIso,
      })
    }

    if (bulkEngine.queue) {
      contexts.push({
        type: "application_queue",
        id: bulkEngine.queue.id,
        title: bulkEngine.queue.title,
        updatedAt: bulkEngine.queue.completedAt ?? nowIso,
      })
    }

    return contexts
  }, [
    workflowEngine.activeWorkflow?.id,
    workflowEngine.activeWorkflow?.activeStepId,
    workflowEngine.activeWorkflow?.pausedAt,
    workflowEngine.activeWorkflow?.completedAt,
    activeResponse?.compare?.winnerJobId,
    activeResponse?.compare?.items?.length,
    workspaceMode,
    activeEntities.jobId,
    activeEntities.jobTitle,
    activeEntities.companyId,
    activeEntities.companyName,
    researchStream.task?.id,
    researchStream.task?.updatedAt,
    researchStream.task?.status,
    restoredResearchTask?.id,
    restoredResearchTask?.updatedAt,
    restoredResearchTask?.status,
    bulkEngine.queue?.id,
    bulkEngine.queue?.completedAt,
  ])

  const continuationContexts = useMemo(() => {
    const source = continuation.state?.resumableContexts ?? []
    return source.filter((context) => !dismissedContinuationIds.has(continuationContextKey(context)))
  }, [continuation.state?.resumableContexts, dismissedContinuationIds])

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

  useEffect(() => {
    let cancelled = false
    fetch("/api/scout/outcomes", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as OutcomeLearningResult | null
        if (!cancelled) setOutcomeLearning(data)
      })
      .catch(() => { if (!cancelled) setOutcomeLearning(null) })
    return () => { cancelled = true }
  }, [])

  // ── Company intel — fetched when company context changes ───────────────────────
  const [companyIntelData, setCompanyIntelData] = useState<{
    intel: import("@/lib/scout/company-intel/types").CompanyIntel
    summary: import("@/lib/scout/company-intel/types").CompanyIntelSummary
    companyName: string
  } | null>(null)
  const [companyIntelLoading, setCompanyIntelLoading] = useState(false)

  useEffect(() => {
    const cid = activeEntities?.companyId
    if (!cid) { setCompanyIntelData(null); return }
    let cancelled = false
    setCompanyIntelLoading(true)
    fetch(`/api/scout/company-intel/${cid}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null)
        if (!cancelled && data?.intel) setCompanyIntelData(data)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCompanyIntelLoading(false) })
    return () => { cancelled = true }
  }, [activeEntities?.companyId])

  // ── Daily missions — generated once data loads, cached in localStorage ────────
  useEffect(() => {
    // Only generate when core data has loaded and we don't have today's missions yet
    if (strategyLoading || behaviorLoading) return
    const cached = readMissionStore()
    if (cached) { setMissionStore(cached); return }
    if (!strategyBoard && !behaviorSignals) return

    const ctx = {
      board:           strategyBoard,
      signals:         behaviorSignals,
      marketSignals,
      searchProfile,
      hasResume:       !!primaryResume,
      outcomeLearning,
    }
    const missions      = generateDailyMissions(ctx)
    const momentumLine  = buildMomentumLine(ctx)
    const store: ScoutMissionStore = {
      date:         "",   // store.ts fills this in
      missions,
      momentumLine,
      disabled:     false,
    }
    writeMissionStore(store)
    setMissionStore(store)
  }, [strategyLoading, behaviorLoading, strategyBoard, behaviorSignals, marketSignals, searchProfile, primaryResume, outcomeLearning])

  // ── Stream state effects ─────────────────────────────────────────────────────

  // Live-update the streaming message bubble as text arrives
  useEffect(() => {
    const id = streamMsgId.current
    if (!id || !scoutStream.isStreaming) return
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, role: "scout_streaming" as const, streamText: scoutStream.streamText } : m
      )
    )
  }, [scoutStream.streamText, scoutStream.isStreaming])

  // When the full response arrives, replace the streaming bubble with the final one
  useEffect(() => {
    const id = streamMsgId.current
    if (!scoutStream.finalResponse || !id) return
    const normalized = scoutStream.finalResponse
    if (commandStartedAtRef.current) {
      lastCommandLatencyRef.current = Date.now() - commandStartedAtRef.current
      commandStartedAtRef.current = null
    }
    lastDebugRef.current = normalized.debug ?? null
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { id, role: "scout" as const, response: normalized } : m
      )
    )
    setIsLoading(false)
    setActiveResponse(normalized)

    const directive = normalized.workspace_directive
    const newMode   = directive?.mode ?? inferWorkspaceMode(normalized)
    setWorkspaceMode(newMode)
    if (newMode !== "idle") setNarrative(buildNarrative(newMode, normalized))
    setActiveEntities((prev) => extractEntities(normalized, prev))

    const profileUpdate = extractProfileUpdate(normalized, "")
    if (Object.keys(profileUpdate).length > 0) {
      setSearchProfile((prev) => {
        const updated = mergeProfileUpdate(prev, profileUpdate)
        writeSearchProfile(updated)
        return updated
      })
    }
    if (newMode === "bulk_application") {
      const bp = directive?.payload ?? {}
      void bulkEngine.initQueue({ count: typeof bp.count === "number" ? bp.count : 10, requireSponsorshipSignal: Boolean(bp.requireSponsorshipSignal), workMode: typeof bp.workMode === "string" ? bp.workMode : undefined, minMatchScore: typeof bp.minMatchScore === "number" ? bp.minMatchScore : undefined })
    }
    if (normalized.workflow_directive && newMode !== "bulk_application") {
      workflowEngine.startWorkflow(normalized.workflow_directive.workflowType, normalized.workflow_directive.payload)
    }
    const railActions = normalized.actions?.filter((a) => ["OPEN_JOB","OPEN_COMPANY","OPEN_RESUME_TAILOR"].includes(a.type))
    const newRail = directive?.rail !== undefined ? (directive.rail ?? null) : railActions?.length ? { title: "Scout context", summary: "Suggested next steps", actions: railActions } : null
    setRail(newRail)
    if (directive?.chips?.length) setChips(directive.chips)
    const updatedCmds = appendCommand(recentCommands, "")
    setHasSession(true)
    writeScoutSession({ mode: newMode, chips: directive?.chips ?? chips, recentCommands: updatedCmds, rail: extractRailMetadata(newRail), modeMetadata: extractModeMetadata(newMode, normalized) })
    streamMsgId.current = null
  }, [scoutStream.finalResponse])

  // Handle stream errors
  useEffect(() => {
    if (!scoutStream.error || scoutStream.isStreaming) return
    commandStartedAtRef.current = null
    lastDebugRef.current = null
    setError(scoutStream.error)
    setIsLoading(false)
    // Replace the streaming bubble with an error notice (remove it)
    const id = streamMsgId.current
    if (id) setMessages((prev) => prev.filter((m) => m.id !== id))
    streamMsgId.current = null
  }, [scoutStream.error, scoutStream.isStreaming])

  // Research stream — task completion: persist, update chips, clear loading
  useEffect(() => {
    const task = researchStream.task
    if (!task || researchStream.isRunning) return
    setIsLoading(false)
    if (task.status === "completed") {
      writeResearchTask(task)
      const followUps = task.followUpCommands ?? []
      if (followUps.length) setChips(followUps)
      const count = task.findings?.length ?? 0
      setNarrative(count > 0
        ? `Found ${count} insight${count !== 1 ? "s" : ""} — review findings below`
        : ""
      )
    }
    if (task.status === "failed") {
      setError("Research could not produce findings. Try a more specific query.")
      setWorkspaceMode("idle")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchStream.isRunning])

  // Research stream error
  useEffect(() => {
    if (!researchStream.error) return
    setError(researchStream.error)
    setIsLoading(false)
  }, [researchStream.error])

  // Career strategy — data loaded
  useEffect(() => {
    if (careerStrategy.loading) return
    setIsLoading(false)
    if (careerStrategy.data) {
      const dirCount = careerStrategy.data.directions.length
      if (dirCount > 0) {
        setNarrative(`Found ${dirCount} career direction${dirCount !== 1 ? "s" : ""} — review below`)
        setChips(["Compare these directions", "What skills should I prioritize?", "Queue matching jobs"])
      }
    }
    if (careerStrategy.error) {
      setError(careerStrategy.error)
      setWorkspaceMode("idle")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerStrategy.loading, careerStrategy.data, careerStrategy.error])

  // ── Timeline tracking effects ───────────────────────────────────────────────
  // Each effect uses a ref to detect meaningful changes so events are never
  // duplicated. These effects are purely observational — they never modify
  // any Scout state.

  // 1. Workspace mode changes (skip idle — it's the default/return state)
  useEffect(() => {
    if (workspaceMode === prevModeRef.current || workspaceMode === "idle") {
      prevModeRef.current = workspaceMode
      return
    }
    prevModeRef.current = workspaceMode
    const LABELS: Partial<Record<WorkspaceMode, string>> = {
      search:           "Scout switched to job search view",
      compare:          "Scout opened job comparison",
      tailor:           "Scout opened resume tailoring",
      applications:     "Scout opened application workflow",
      bulk_application: "Scout opened bulk application queue",
      company:          "Scout opened company intelligence",
      research:         "Scout started a research task",
    }
    const replayAction: ScoutTimelineReplayAction | undefined =
      workspaceMode === "bulk_application"
        ? undefined
        : workspaceMode === "compare"
        ? { type: "reopen_compare", payload: { activeEntities } }
        : {
            type: "restore_workspace",
            payload: {
              mode: workspaceMode,
              activeEntities,
            },
          }

    timeline.append({
      type:      "workspace_change",
      title:     LABELS[workspaceMode] ?? `Workspace changed to ${workspaceMode}`,
      timestamp: new Date().toISOString(),
      severity:  "info",
      replayable: Boolean(replayAction),
      replayAction,
      metadata: IS_DEV
        ? {
            commandLatencyMs: lastCommandLatencyRef.current ?? undefined,
            orchestratorTotalMs: lastDebugRef.current?.orchestrator?.totalDurationMs,
            orchestratorIntent: lastDebugRef.current?.orchestrator?.intent,
            orchestratorTraces: lastDebugRef.current?.orchestrator?.traces,
            debugOnly: true,
          }
        : undefined,
    })
    lastCommandLatencyRef.current = null
    lastDebugRef.current = null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceMode])

  // 2. Workflow started + step changes
  useEffect(() => {
    const wf = workflowEngine.activeWorkflow
    if (!wf) { prevWorkflowIdRef.current = null; prevWorkflowStepRef.current = null; return }

    if (wf.id !== prevWorkflowIdRef.current) {
      prevWorkflowIdRef.current = wf.id
      prevWorkflowStepRef.current = wf.activeStepId ?? null
      timeline.append({
        type:     "workflow_started",
        title:    `Workflow started: ${wf.title}`,
        summary:  wf.goal,
        timestamp: new Date().toISOString(),
        severity: "info",
        replayable: true,
        replayAction: {
          type: "reopen_workflow",
          payload: {
            workflowId: wf.id,
            title: wf.title,
            activeStepId: wf.activeStepId,
          },
        },
        metadata: IS_DEV
          ? {
              workflowId: wf.id,
              stepCount: wf.steps.length,
              debugOnly: true,
            }
          : undefined,
      })
      return
    }

    if (wf.activeStepId && wf.activeStepId !== prevWorkflowStepRef.current) {
      prevWorkflowStepRef.current = wf.activeStepId
      const step = wf.steps.find((s) => s.id === wf.activeStepId)
      if (!step || step.status === "pending") return
      timeline.append({
        type:      "workflow_step",
        title:     step.title,
        summary:   step.description,
        timestamp: new Date().toISOString(),
        severity:  step.status === "failed" ? "error" : step.requiresConfirmation ? "warning" : "info",
        metadata:  IS_DEV ? { stepId: step.id, status: step.status, actionType: step.actionType } : undefined,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowEngine.activeWorkflow?.id, workflowEngine.activeWorkflow?.activeStepId])

  // 3. Extension browser context (pageType + autofill)
  useEffect(() => {
    if (!browserContext || browserContext.pageType === "unknown") {
      prevBrowserCtxKey.current = null
      prevResolvedJobIdRef.current = null
      return
    }
    const key = [
      browserContext.pageType,
      browserContext.atsProvider ?? "",
      String(Boolean(browserContext.autofillAvailable)),
      browserContext.url,
    ].join(":")
    if (key === prevBrowserCtxKey.current) return
    const wasAutofill = prevBrowserCtxKey.current?.includes(":true:") ?? false
    prevBrowserCtxKey.current = key

    if (browserContext.autofillAvailable && !wasAutofill) {
      timeline.append({
        type:      "autofill_detected",
        title:     "Autofill available on active tab",
        summary:   browserContext.atsProvider ? `ATS: ${browserContext.atsProvider}` : undefined,
        timestamp: new Date().toISOString(),
        severity:  "info",
        metadata:  IS_DEV
          ? {
              ats: browserContext.atsProvider,
              fieldsCount: browserContext.detectedFieldsCount,
              pageUrl: browserContext.url,
              debugOnly: true,
            }
          : undefined,
      })
    } else {
      timeline.append({
        type:      "extension_detected_page",
        title:     `Extension detected ${browserContext.pageType.replace(/_/g, " ")}`,
        summary:   browserContext.atsProvider ? `ATS: ${browserContext.atsProvider}` : browserContext.company ?? undefined,
        timestamp: new Date().toISOString(),
        severity:  "info",
        metadata:  IS_DEV
          ? {
              pageType: browserContext.pageType,
              ats: browserContext.atsProvider,
              pageUrl: browserContext.url,
              debugOnly: true,
            }
          : undefined,
      })
    }

    if (browserContext.detectedJobId && browserContext.detectedJobId !== prevResolvedJobIdRef.current) {
      prevResolvedJobIdRef.current = browserContext.detectedJobId
      timeline.append({
        type:      "job_resolved",
        title:     "Job resolved from active tab",
        summary:   browserContext.title ?? undefined,
        timestamp: new Date().toISOString(),
        severity:  "info",
        replayable: true,
        replayAction: {
          type: "restore_job_context",
          payload: {
            jobId: browserContext.detectedJobId,
            companyName: browserContext.company,
            jobTitle: browserContext.title,
          },
        },
        metadata:  IS_DEV
          ? {
              jobId: browserContext.detectedJobId,
              pageUrl: browserContext.url,
              debugOnly: true,
            }
          : undefined,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserContext?.pageType, browserContext?.autofillAvailable, browserContext?.detectedJobId])

  // 4. Research task started + findings
  useEffect(() => {
    const task = researchStream.task
    if (!task) return

    if (task.id !== prevResearchIdRef.current) {
      const startLatencyMs = commandStartedAtRef.current
        ? Date.now() - commandStartedAtRef.current
        : undefined
      if (commandStartedAtRef.current) commandStartedAtRef.current = null
      prevResearchIdRef.current = task.id
      prevFindingCountRef.current = 0
      timeline.append({
        type:      "research_started",
        title:     `Research: ${task.title}`,
        summary:   task.objective.length > 100 ? `${task.objective.slice(0, 100)}…` : task.objective,
        timestamp: new Date().toISOString(),
        severity:  "info",
        replayable: true,
        replayAction: { type: "reopen_research", payload: { taskId: task.id } },
        metadata:  IS_DEV
          ? {
              taskId: task.id,
              stepCount: task.steps.length,
              startLatencyMs,
              debugOnly: true,
            }
          : undefined,
      })
    }

    const count = task.findings?.length ?? 0
    if (count > prevFindingCountRef.current) {
      const newFindings = (task.findings ?? []).slice(prevFindingCountRef.current)
      prevFindingCountRef.current = count
      for (const finding of newFindings) {
        timeline.append({
          type:      "research_finding",
          title:     finding.title,
          summary:   finding.type.replace(/_/g, " "),
          timestamp: new Date().toISOString(),
          severity:  "info",
          metadata:  IS_DEV
            ? {
                findingType: finding.type,
                confidence: finding.confidence,
                debugOnly: true,
              }
            : undefined,
        })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchStream.task?.id, researchStream.task?.findings?.length])

  // 5. Permission gates
  useEffect(() => {
    if (!activeGate) { prevGateKeyRef.current = null; return }
    const key = activeGate.permission as string
    if (key === prevGateKeyRef.current) return
    prevGateKeyRef.current = key
    timeline.append({
      type:      "permission_prompt",
      title:     activeGate.title || `Permission required: ${key.replace(/_/g, " ")}`,
      summary:   activeGate.description || "Awaiting your approval before Scout proceeds",
      timestamp: new Date().toISOString(),
      severity:  "warning",
      metadata:  IS_DEV ? { permission: key, debugOnly: true } : undefined,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate])

  // 6. Errors
  useEffect(() => {
    const err = scoutStream.error ?? researchStream.error
    if (!err) return
    timeline.append({
      type:      "error",
      title:     "Scout encountered an error",
      summary:   err.length > 120 ? `${err.slice(0, 120)}…` : err,
      timestamp: new Date().toISOString(),
      severity:  "error",
      metadata: IS_DEV
        ? {
            source: scoutStream.error ? "scout_stream" : "research_stream",
            debugOnly: true,
          }
        : undefined,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoutStream.error, researchStream.error])

  // 7. Bulk application queue transitions (application workflow observability)
  useEffect(() => {
    const queue = bulkEngine.queue
    if (!queue) {
      prevQueueIdRef.current = null
      prevQueueStatusRef.current = {}
      prevQueueCompletedAtRef.current = null
      return
    }

    if (queue.id !== prevQueueIdRef.current) {
      prevQueueIdRef.current = queue.id
      prevQueueStatusRef.current = {}
      prevQueueCompletedAtRef.current = null
      timeline.append({
        type: "workflow_started",
        title: queue.title,
        summary: `${queue.jobs.length} job${queue.jobs.length !== 1 ? "s" : ""} queued for preparation`,
        timestamp: new Date().toISOString(),
        severity: "info",
        replayable: true,
        replayAction: { type: "restore_workspace", payload: { mode: "bulk_application" } },
        metadata: IS_DEV ? { queueId: queue.id, debugOnly: true } : undefined,
      })
    }

    const previous = prevQueueStatusRef.current
    const next: Record<string, string> = {}

    for (const job of queue.jobs) {
      next[job.queueId] = job.status
      const prev = previous[job.queueId]

      if (!prev) continue
      if (prev === job.status) continue

      if (job.status === "submitted") {
        timeline.append({
          type: "manual_submit",
          title: `Manual submit complete: ${job.jobTitle}`,
          summary: job.company ? `${job.company}` : undefined,
          timestamp: new Date().toISOString(),
          severity: "info",
          replayable: true,
          replayAction: {
            type: "restore_job_context",
            payload: {
              jobId: job.jobId,
              jobTitle: job.jobTitle,
              companyName: job.company,
            },
          },
          metadata: IS_DEV ? { queueId: queue.id, queueItemId: job.queueId, debugOnly: true } : undefined,
        })
        continue
      }

      timeline.append({
        type: "workflow_step",
        title: `${job.jobTitle}: ${queueStatusLabel(job.status)}`,
        summary: job.company ?? undefined,
        timestamp: new Date().toISOString(),
        severity: job.status === "failed" ? "error" : job.status === "needs_review" ? "warning" : "info",
        metadata: IS_DEV
          ? {
              queueId: queue.id,
              queueItemId: job.queueId,
              from: prev,
              to: job.status,
              debugOnly: true,
            }
          : undefined,
      })
    }

    prevQueueStatusRef.current = next

    if (queue.completedAt && queue.completedAt !== prevQueueCompletedAtRef.current) {
      prevQueueCompletedAtRef.current = queue.completedAt
      timeline.append({
        type: "workflow_step",
        title: "Bulk preparation queue completed",
        summary: `${queue.jobs.filter((j) => j.status === "ready" || j.status === "needs_review").length} ready for review`,
        timestamp: new Date().toISOString(),
        severity: "info",
        replayable: true,
        replayAction: { type: "restore_workspace", payload: { mode: "bulk_application" } },
        metadata: IS_DEV ? { queueId: queue.id, debugOnly: true } : undefined,
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkEngine.queue?.id, bulkEngine.queue?.jobs, bulkEngine.queue?.completedAt])

  // Early workspace directive — morph before Claude finishes
  useEffect(() => {
    if (!scoutStream.earlyDirective) return
    const mode = scoutStream.earlyDirective.mode ?? "idle"
    if (mode !== "idle") setWorkspaceMode(mode)
  }, [scoutStream.earlyDirective])

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (event: React.FormEvent, overrideMessage?: string) => {
      event.preventDefault()
      const message = (overrideMessage ?? query).trim()
      if (!message || isLoading || scoutStream.isStreaming || researchStream.isRunning) return

      const msgId = `s-${Date.now()}`
      streamMsgId.current = msgId

      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text: message },
        { id: msgId, role: "scout_streaming", streamText: "" },
      ])
      setQuery("")
      setIsLoading(true)
      setError(null)
      setNarrative("")
      setNarrativeDismissed(false)
      commandStartedAtRef.current = Date.now()

      // Record every user command in the timeline
      timeline.append({
        type:      "command",
        title:     message.length > 80 ? `${message.slice(0, 80)}…` : message,
        timestamp: new Date().toISOString(),
        severity:  "info",
        replayable: true,
        replayAction: { type: "resend_command", payload: { message } },
        metadata: IS_DEV
          ? {
              mode: workspaceMode,
              hasBrowserContext: Boolean(browserContext && browserContext.pageType !== "unknown"),
            }
          : undefined,
      })

      // ── Career strategy — before research (research RE also catches career phrases) ──
      if (isCareerStrategyIntent(message)) {
        setWorkspaceMode("career_strategy")
        setNarrative(PREFLIGHT_NARRATIVE.career_strategy ?? "")
        careerStrategy.reset()
        void careerStrategy.generate(message)
        const updatedCmds = appendCommand(recentCommands, message)
        setRecentCommands(updatedCmds)
        setHasSession(true)
        return
      }

      // ── Research intent — route to research endpoint, not chat ────────────
      if (isResearchIntent(message)) {
        setWorkspaceMode("research")
        setNarrative(PREFLIGHT_NARRATIVE.research ?? "")
        researchStream.reset()
        void researchStream.startStream("/api/scout/research", {
          message,
          ...contextIds,
        })
        const updatedCmds = appendCommand(recentCommands, message)
        setRecentCommands(updatedCmds)
        setHasSession(true)
        return
      }

      // ── Pre-flight: morph workspace immediately before network call ────────
      const preflightMode = detectPreflightMode(message)
      if (preflightMode) {
        setWorkspaceMode(preflightMode)
        const preflightNarrative = PREFLIGHT_NARRATIVE[preflightMode]
        if (preflightNarrative) setNarrative(preflightNarrative)
      }

      // ── Start SSE stream ───────────────────────────────────────────────────
      void scoutStream.startStream("/api/scout/chat", {
        message, pagePath: pathname, commandMode: true, focusMode: isFocusMode,
        activeFilters: {
          q: searchParams.get("q") ?? undefined, location: searchParams.get("location") ?? undefined,
          sponsorship: searchParams.get("sponsorship") ?? undefined, workMode: searchParams.get("workMode") ?? undefined,
        },
        ...contextIds,
        ...(searchProfile ? { searchProfile } : {}),
      })

      // Session command history (pre-record; final session write happens in stream effect)
      const updatedCmds = appendCommand(recentCommands, message)
      setRecentCommands(updatedCmds)
      setHasSession(true)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, isLoading, pathname, isFocusMode, searchParams, contextIds, searchProfile, recentCommands]
  )

  function handleChipClick(chip: string) { setQuery(chip); setTimeout(() => inputRef.current?.focus(), 50) }
  function handleFollowUp(text: string)  { setQuery(text); setTimeout(() => inputRef.current?.focus(), 50) }
  function handleSendCommand(query: string) { setQuery(query); setTimeout(() => inputRef.current?.focus(), 50) }

  function handleOpenProactive(event: ScoutProactiveEvent) {
    proactive.snooze(event.id, 2 * 60 * 60 * 1000)
    timeline.append({
      type: "workspace_change",
      title: `Proactive suggestion opened: ${event.title}`,
      summary: event.type.replace(/_/g, " "),
      timestamp: new Date().toISOString(),
      severity: event.severity === "urgent" ? "warning" : "info",
    })

    switch (event.type) {
      case "queue_ready":
        setWorkspaceMode("bulk_application")
        break
      case "workflow_reminder":
        workflowEngine.setExpanded(true)
        setWorkspaceMode("applications")
        break
      case "company_activity":
        if (event.relatedCompanyId) {
          setActiveEntities((prev) => ({ ...prev, companyId: event.relatedCompanyId }))
          setWorkspaceMode("company")
          break
        }
        setQuery(proactiveCommandSuggestion(event))
        setTimeout(() => inputRef.current?.focus(), 50)
        break
      case "interview_reminder":
        if (event.relatedJobId) {
          setActiveEntities((prev) => ({ ...prev, jobId: event.relatedJobId }))
        }
        setWorkspaceMode("applications")
        setQuery(proactiveCommandSuggestion(event))
        setTimeout(() => inputRef.current?.focus(), 50)
        break
      default:
        setQuery(proactiveCommandSuggestion(event))
        setTimeout(() => inputRef.current?.focus(), 50)
        break
    }
  }

  // ── Timeline replay ─────────────────────────────────────────────────────────
  function handleReplay(action: ScoutTimelineReplayAction) {
    switch (action.type) {
      case "resend_command": {
        const msg = action.payload?.message as string | undefined
        if (msg) { setQuery(msg); setTimeout(() => inputRef.current?.focus(), 50) }
        break
      }
      case "reopen_workflow":
        workflowEngine.setExpanded(true)
        setWorkspaceMode("applications")
        break
      case "reopen_research": {
        const cached = readResearchTask()
        if (cached) { setRestoredResearchTask(cached); setWorkspaceMode("research") }
        break
      }
      case "reopen_compare":
        setWorkspaceMode("compare")
        break
      case "restore_workspace": {
        const mode = action.payload?.mode as WorkspaceMode | undefined
        if (mode && mode !== "idle") setWorkspaceMode(mode)
        const entities = action.payload?.activeEntities as ActiveEntities | undefined
        if (entities && typeof entities === "object") setActiveEntities((prev) => ({ ...prev, ...entities }))
        break
      }
      case "restore_job_context": {
        const payload = action.payload ?? {}
        setActiveEntities((prev) => ({
          ...prev,
          jobId: typeof payload.jobId === "string" ? payload.jobId : prev.jobId,
          jobTitle: typeof payload.jobTitle === "string" ? payload.jobTitle : prev.jobTitle,
          companyName: typeof payload.companyName === "string" ? payload.companyName : prev.companyName,
        }))
        setWorkspaceMode((m) => (m === "idle" ? "applications" : m))
        break
      }
    }
  }

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
  const showProactiveStrip =
    proactive.settings.enabled &&
    workspaceMode === "idle" &&
    !isLoading &&
    !scoutStream.isStreaming &&
    !researchStream.isRunning &&
    query.trim().length === 0 &&
    Boolean(proactive.topEvent)

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
            {/* Streaming activity indicator + cancel button */}
            {(scoutStream.isStreaming || researchStream.isRunning) && (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[10px] font-medium text-[#FF5C18]/80">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF5C18]" />
                  {researchStream.isRunning ? "Researching…" : "Thinking…"}
                </span>
                <button
                  type="button"
                  onClick={researchStream.isRunning ? researchStream.cancel : scoutStream.cancel}
                  title="Stop Scout"
                  className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold text-slate-400 transition hover:border-red-500/40 hover:text-red-400"
                >
                  Stop
                </button>
              </div>
            )}
            {workspaceMode !== "idle" && !scoutStream.isStreaming && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FF5C18]" />
                {workspaceMode}
              </span>
            )}
            {/* Activity timeline toggle */}
            <button
              type="button"
              onClick={() => setShowTimeline((v) => !v)}
              title="Activity timeline"
              className={cn(
                "inline-flex items-center gap-1.5 text-[11px] font-medium transition",
                showTimeline ? "text-[#FF5C18]" : "text-slate-500 hover:text-slate-300",
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              {timeline.events.length > 0 && (
                <span className="rounded-full bg-slate-700 px-1 py-0.5 text-[9px] tabular-nums text-slate-300">
                  {timeline.events.length}
                </span>
              )}
            </button>
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

      {/* ── Browser action strip — non-intrusive, shown only when operator is active ── */}
      {operator.activeAction && (
        <BrowserActionStrip
          action={operator.activeAction}
          onApprove={operator.approve}
          onCancel={operator.cancel}
          onDismiss={operator.cancel}
        />
      )}

      {/* ── Workspace ─────────────────────────────────────────────────── */}
      <div className="app-shell flex w-full max-w-6xl gap-6 py-6 pb-16">

        {/* Main surface — no key remounting, CSS fade-through */}
        <div className="min-w-0 flex-1">

          {/* Proactive companion strip (non-intrusive, idle only) */}
          {showProactiveStrip && (
            <ScoutProactiveStrip
              event={proactive.topEvent}
              enabled={proactive.settings.enabled}
              onOpen={handleOpenProactive}
              onDismiss={proactive.dismiss}
              onSnooze={proactive.snooze}
              onDisable={() => proactive.setEnabled(false)}
            />
          )}

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
                    missions={missionStore?.disabled ? [] : (missionStore?.missions ?? [])}
                    momentumLine={missionStore?.momentumLine}
                    onMissionLaunch={(q) => {
                      setQuery(q)
                      setTimeout(() => inputRef.current?.focus(), 50)
                    }}
                    onMissionDismiss={(id) => {
                      setMissionStore((prev) => prev ? patchMissionStatus(prev, id, "dismissed") : prev)
                    }}
                    onMissionsDisable={() => {
                      setMissionsDisabled(true)
                      setMissionStore((prev) => prev ? { ...prev, disabled: true } : prev)
                    }}
                    proactiveEvents={proactive.visibleEvents}
                    onProactiveOpen={handleOpenProactive}
                    onProactiveDismiss={proactive.dismiss}
                    onProactiveSnooze={proactive.snooze}
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
              if (displayedMode === "company") {
                const companyId = activeEntities?.companyId
                  ?? activeResponse?.actions?.find((a) => a.type === "OPEN_COMPANY")?.payload?.companyId
                  ?? activeResponse?.workspace_directive?.payload?.companyId as string | undefined
                if (!companyId) return null
                return (
                  <CompanyMode
                    companyId={companyId}
                    companyName={activeEntities?.companyName}
                    onFollowUp={handleFollowUp}
                  />
                )
              }
              if (displayedMode === "bulk_application") {
                return (
                  <BulkApplicationMode
                    engine={bulkEngine}
                    onFollowUp={handleFollowUp}
                    onOpenApp={(applyUrl) => window.open(applyUrl, "_blank", "noopener,noreferrer")}
                  />
                )
              }
              if (displayedMode === "research") {
                return (
                  <ResearchMode
                    task={researchStream.task ?? restoredResearchTask}
                    isRunning={researchStream.isRunning}
                    onCommand={(cmd) => { setQuery(cmd); setTimeout(() => inputRef.current?.focus(), 50) }}
                  />
                )
              }
              if (displayedMode === "outreach" && activeResponse) {
                return (
                  <OutreachMode
                    response={activeResponse}
                    onFollowUp={handleFollowUp}
                    activeEntities={activeEntities}
                  />
                )
              }
              if (displayedMode === "interview" && activeResponse) {
                return (
                  <InterviewPrepMode
                    response={activeResponse}
                    onFollowUp={handleFollowUp}
                    activeEntities={activeEntities}
                  />
                )
              }
              if (displayedMode === "career_strategy") {
                return (
                  <CareerStrategyMode
                    data={careerStrategy.data}
                    loading={careerStrategy.loading}
                    error={careerStrategy.error}
                    onCommand={(cmd) => { setQuery(cmd); setTimeout(() => inputRef.current?.focus(), 50) }}
                  />
                )
              }
              // Fallback for restored session with no activeResponse
              return null
            }}
          />
        </div>

        {/* Right intelligence rail — Timeline > Company intel > Scout rail > browser context > market signals */}
        {(showTimeline || companyIntelData || companyIntelLoading || rail || (browserContext && browserContext.pageType !== "unknown") || marketSignals.length > 0 || proactiveRailEvents.length > 0) && (
          <div className="hidden lg:flex flex-col gap-4 transition-all duration-200 opacity-100 translate-x-0">
            {/* Activity timeline panel */}
            {showTimeline && (
              <ScoutTimelinePanel
                events={timeline.events}
                onClose={() => setShowTimeline(false)}
                onReplay={handleReplay}
                onClear={timeline.clear}
                isDev={IS_DEV}
              />
            )}
            {/* Company intel rail — shown when company context is active */}
            {(companyIntelData || companyIntelLoading) && activeEntities?.companyId ? (
              <CompanyIntelRail
                companyId={activeEntities.companyId}
                companyName={activeEntities.companyName ?? companyIntelData?.companyName ?? "Company"}
                intel={companyIntelData?.intel ?? null}
                summary={companyIntelData?.summary ?? null}
                loading={companyIntelLoading}
                onClose={() => setCompanyIntelData(null)}
              />
            ) : rail ? (
              <ContextRail rail={rail} onClose={() => setRail(null)} />
            ) : browserContext && browserContext.pageType !== "unknown" ? (
              <BrowserContextRail
                context={browserContext}
                activeWorkflow={workflowEngine.activeWorkflow}
                latestEvents={latestRailEvents}
                proactiveEvents={proactiveRailEvents}
                onPreFill={(query) => {
                  // For autofill queries on application forms, also dispatch operator action
                  if (/autofill/i.test(query) && browserContext.pageType === "application_form") {
                    operator.execute("prepare_autofill", {
                      context: { company: browserContext.company, atsProvider: browserContext.atsProvider },
                    })
                  }
                  handleSendCommand(query)
                }}
                onExpandWorkflow={() => workflowEngine.setExpanded(true)}
                onOpenProactive={handleOpenProactive}
              />
            ) : null}

            {/* Proactive companion rail */}
            <ScoutProactiveRail
              events={proactiveRailEvents}
              enabled={proactive.settings.enabled}
              mutedCount={proactive.settings.mutedTypes.length}
              loading={proactive.loading}
              onOpen={handleOpenProactive}
              onDismiss={proactive.dismiss}
              onSnooze={proactive.snooze}
              onMuteType={proactive.muteType}
              onClearMutedTypes={proactive.clearMutedTypes}
              onSetEnabled={proactive.setEnabled}
            />

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

      {/* ── Bulk confirm dialog — modal, shown immediately on trigger ── */}
      {bulkEngine.isConfirming && (
        <BulkConfirmDialog
          jobs={bulkEngine.confirmJobs}
          onConfirm={bulkEngine.confirmStart}
          onEditList={bulkEngine.cancelConfirm}
          onCancel={bulkEngine.cancelConfirm}
        />
      )}

      {/* ── Bulk review drawer — slides in from the right ───────────── */}
      {(() => {
        const reviewJob = bulkEngine.queue?.jobs.find(
          (j) => j.queueId === bulkEngine.reviewingQueueId
        )
        if (!reviewJob) return null
        return (
          <BulkReviewDrawer
            job={reviewJob}
            onClose={bulkEngine.closeReview}
            onOpenApp={(applyUrl, _queueId) => window.open(applyUrl, "_blank", "noopener,noreferrer")}
            onMarkSubmitted={bulkEngine.markSubmitted}
            onSkip={bulkEngine.skipJob}
          />
        )
      })()}
    </main>
  )
}
