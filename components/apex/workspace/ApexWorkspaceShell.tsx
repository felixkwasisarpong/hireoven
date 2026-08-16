"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { MoreHorizontal, Sparkles, Target, X } from "lucide-react"
import { ApexAlertBadge } from "@/components/apex/ApexAlertBadge"
import { ApexIcon } from "@/components/apex/ApexIcon"
import { runQualityControl, buildQCContext } from "@/lib/apex/quality-control"
import { ApexCommandBar } from "./ApexCommandBar"
import { WorkspaceSurface } from "./WorkspaceSurface"
import { IdleMode } from "./IdleMode"
import { BrowserActionStrip } from "./BrowserActionStrip"
import { ApexLeftPanel } from "./ApexLeftPanel"
import { ApexThinkingCanvas } from "./ApexThinkingCanvas"
import { ApexWelcomeScene } from "./scenes/ApexWelcomeScene"
import { ApexStoryScene } from "./scenes/ApexStoryScene"
import { ApexWorkspaceStage } from "./scenes/ApexWorkspaceStage"
import { ApexContextPanel, type ContextPanelTab } from "./scenes/ApexContextPanel"
import { ApexErrorBoundary } from "@/components/apex/ApexErrorBoundary"
import { ApexMemoryChips } from "@/components/apex/ApexMemoryChips"
import { ApexProactiveStrip } from "@/components/apex/proactive/ApexProactiveStrip"
import { useWorkflowEngine } from "@/lib/apex/workflows/engine"
import { useBulkApplicationEngine } from "@/lib/apex/bulk-application/engine"
import { useApexStream } from "@/hooks/useApexStream"
import { useResearchStream } from "@/hooks/useResearchStream"
import { detectPreflightMode, PREFLIGHT_NARRATIVE } from "@/lib/apex/streaming/intent-preflight"
import { resolveExecutableApexCommand } from "@/lib/apex/command-normalizer"
import { isAutonomousHuntIntent } from "@/lib/apex/hunt/intent"
import { isResearchIntent } from "@/lib/apex/research/tasks"
import { writeResearchTask, readResearchTask } from "@/lib/apex/research/store"
import { isCareerStrategyIntent } from "@/lib/apex/career/intent"
import { useCareerStrategy } from "@/hooks/useCareerStrategy"
import { useAutonomousHunt } from "@/hooks/useAutonomousHunt"
import { useApexBrowserOperator } from "@/hooks/useApexBrowserOperator"
import { APEX_FLAGS } from "@/lib/apex/flags"
import {
  isExtPromosDismissed,
  dismissExtPromo,
} from "@/lib/apex/first-run"
import { useApexTimeline } from "@/hooks/useApexTimeline"
import { useApexProactive } from "@/hooks/useApexProactive"
import type {
  ApexTimelineEvent,
  ApexTimelineReplayAction,
} from "@/lib/apex/timeline/types"
import type { ApexProactiveEvent } from "@/lib/apex/proactive/types"
import type { ApexResearchTask } from "@/lib/apex/research/types"
import { generateDailyMissions, buildMomentumLine } from "@/lib/apex/missions/generator"
import {
  readMissionStore,
  writeMissionStore,
  patchMissionStatus,
  setMissionsDisabled,
} from "@/lib/apex/missions/store"
import type { ApexMissionStore } from "@/lib/apex/missions/types"
import { useActiveBrowserContext } from "@/lib/apex/browser-context"
import { getContextualChips, getContextualPlaceholder } from "@/lib/apex/context-chips"
import { writePinnedContext } from "@/lib/apex/pinned-context"
import {
  readSearchProfile,
  writeSearchProfile,
  clearSearchProfile,
  mergeProfileUpdate,
  extractProfileUpdate,
  buildMemoryChips,
  type ApexSearchProfile,
} from "@/lib/apex/search-profile"
import { getPersonalizedChips } from "@/lib/apex/mode"
import { extractCareerSiteUrlFromMessage } from "@/lib/apex/career-site-intent"
import { readPermissions, type ApexPermissionState } from "@/lib/apex/permissions"
import { getApexSuggestionChips } from "@/lib/apex/mode"
import { getApexNudges } from "@/lib/apex/nudges"
import { detectApexMode } from "@/lib/apex/mode"
import { inferWorkspaceMode, type WorkspaceMode, type WorkspaceRail } from "@/lib/apex/workspace"
import {
  appendCommand,
  clearApexSession,
  extractModeMetadata,
  extractRailMetadata,
  readApexSession,
  writeApexSession,
} from "@/lib/apex/session"
import { useResumeContext } from "@/components/resume/ResumeProvider"
import { useAuth } from "@/lib/hooks/useAuth"
import type { ApplyAgentDirective } from "@/lib/apex/apply-agent/types"
import type { ApexResponse, ApexStrategyBoard } from "@/lib/apex/types"
import type { ApexBehaviorSignals } from "@/lib/apex/behavior"
import type { ApexNudge } from "@/lib/apex/nudges"
import type { OutcomeLearningResult } from "@/lib/apex/outcomes/types"
import { useApexContinuation } from "@/hooks/useApexContinuation"
import { mergeResumableContexts } from "@/lib/apex/continuation/sanitize"
import type { ApexResumableContext } from "@/lib/apex/continuation/types"
import type { MarketSignal } from "@/lib/apex/market-intelligence"
import type { CareerTwinSnapshot } from "@/lib/apex/career-twin/types"
import { cn } from "@/lib/utils"

// ── Lazy-loaded workspace modes (only one is rendered at a time) ──────────────
const SearchMode         = dynamic(() => import("./SearchMode").then(m => ({ default: m.SearchMode })), { ssr: false })
const CompareMode        = dynamic(() => import("./CompareMode").then(m => ({ default: m.CompareMode })), { ssr: false })
const TailorMode         = dynamic(() => import("./TailorMode").then(m => ({ default: m.TailorMode })), { ssr: false })
const ApplicationMode    = dynamic(() => import("./ApplicationMode").then(m => ({ default: m.ApplicationMode })), { ssr: false })
const BulkApplicationMode = dynamic(() => import("./BulkApplicationMode").then(m => ({ default: m.BulkApplicationMode })), { ssr: false })
const CompanyMode        = dynamic(() => import("./CompanyMode").then(m => ({ default: m.CompanyMode })), { ssr: false })
const ResearchMode       = dynamic(() => import("./ResearchMode").then(m => ({ default: m.ResearchMode })), { ssr: false })
const OutreachMode       = dynamic(() => import("./OutreachMode").then(m => ({ default: m.OutreachMode })), { ssr: false })
const InterviewPrepMode  = dynamic(() => import("./InterviewPrepMode").then(m => ({ default: m.InterviewPrepMode })), { ssr: false })
const CareerStrategyMode = dynamic(() => import("./CareerStrategyMode").then(m => ({ default: m.CareerStrategyMode })), { ssr: false })
const AutonomousHuntMode = dynamic(() => import("./AutonomousHuntMode").then(m => ({ default: m.AutonomousHuntMode })), { ssr: false })
const ApplyAgentFlow     = dynamic(() => import("@/components/apex/ApplyAgentFlow").then(m => ({ default: m.ApplyAgentFlow })), { ssr: false })
const JDDecoderPanel     = dynamic(() => import("@/components/apex/JDDecoderPanel").then(m => ({ default: m.JDDecoderPanel })), { ssr: false })
const ReputationGuardPanel = dynamic(() => import("@/components/apex/ReputationGuardPanel").then(m => ({ default: m.ReputationGuardPanel })), { ssr: false })
const PipelineSimulator  = dynamic(() => import("@/components/apex/PipelineSimulator").then(m => ({ default: m.PipelineSimulator })), { ssr: false })
const ShadowNetworkMode  = dynamic(() => import("./ShadowNetworkMode").then(m => ({ default: m.ShadowNetworkMode })), { ssr: false })
const AutoApplyPanel     = dynamic(() => import("@/components/apex/AutoApplyPanel").then(m => ({ default: m.AutoApplyPanel })), { ssr: false })

// ── Lazy-loaded panels (opened on demand) ─────────────────────────────────────
const ApexCommandPalette = dynamic(() => import("./ApexCommandPalette").then(m => ({ default: m.ApexCommandPalette })), { ssr: false })
const WorkflowPanel       = dynamic(() => import("@/components/apex/workflows/WorkflowPanel").then(m => ({ default: m.WorkflowPanel })), { ssr: false })
const ApexActionGate     = dynamic(() => import("@/components/apex/ApexActionGate").then(m => ({ default: m.ApexActionGate })), { ssr: false })
const ApexPermissionsPanel = dynamic(() => import("@/components/apex/ApexPermissionsPanel").then(m => ({ default: m.ApexPermissionsPanel })), { ssr: false })
const ApexMemoryPanel    = dynamic(() => import("@/components/apex/memory/ApexMemoryPanel").then(m => ({ default: m.ApexMemoryPanel })), { ssr: false })
const BulkConfirmDialog   = dynamic(() => import("@/components/apex/bulk/BulkConfirmDialog").then(m => ({ default: m.BulkConfirmDialog })), { ssr: false })
const BulkReviewDrawer    = dynamic(() => import("@/components/apex/bulk/BulkReviewDrawer").then(m => ({ default: m.BulkReviewDrawer })), { ssr: false })
const ApexContinuationStrip = dynamic(() => import("@/components/apex/continuation/ApexContinuationStrip").then(m => ({ default: m.ApexContinuationStrip })), { ssr: false })

type ChatMessage =
  | { id: string; role: "user";           text: string }
  | { id: string; role: "apex";          response: ApexResponse }
  | { id: string; role: "apex_streaming"; streamText: string }

/** Entities carried across workspace mode transitions */
export type ActiveEntities = {
  jobId?: string
  jobTitle?: string
  companyId?: string
  companyName?: string
}

/** Extract safe entity identifiers from a Apex response (no text content). */
function extractEntities(
  response: ApexResponse,
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

  // Pull companyName / jobTitle from workspace_directive.payload
  const payload = response.workspace_directive?.payload
  if (payload) {
    if (typeof payload.companyName === "string" && payload.companyName) next.companyName = payload.companyName
    if (typeof payload.jobTitle    === "string" && payload.jobTitle)    next.jobTitle    = payload.jobTitle
    if (typeof payload.jobId       === "string" && payload.jobId)       next.jobId       = payload.jobId
  }

  // If we still don't have a company name, try to extract it from the answer text.
  // Claude often says "Shadow Network for Stripe" or "connections at Acme Corp".
  if (!next.companyName && response.workspace_directive?.mode === "shadow_network") {
    const answer = response.answer ?? ""
    const m =
      answer.match(/Shadow Network for ([A-Za-z0-9 &'.,]+?)(?:\s*[-–]|\s+based|\s+to\s+surface|[.,]|$)/i) ??
      answer.match(/connections? at ([A-Za-z0-9 &'.,]+?)(?:\s+based|\s+to\s+surface|[.,]|$)/i) ??
      answer.match(/who (?:you|I) know at ([A-Za-z0-9 &'.,]+?)(?:\s+based|\s+to\s+surface|[.,]|$)/i) ??
      answer.match(/(?:network|referral).{0,20}at ([A-Za-z0-9 &'.,]+?)(?:\s*[-–]|\s+based|[.,]|$)/i)
    const extracted = m?.[1]?.trim().replace(/\s+$/, "")
    if (extracted && extracted.length < 60) next.companyName = extracted
  }

  return next
}

/** Derive a short Apex narrative string from a response. */
function buildNarrative(mode: WorkspaceMode, response: ApexResponse): string {
  const answer = response.answer?.trim()
  if (!answer || /^\s*[{[]/.test(answer)) {
    const labels: Record<WorkspaceMode, string> = {
      search:            "Apex prepared a filtered job search.",
      compare:           "Apex compared your saved roles.",
      tailor:            "Apex identified tailoring opportunities.",
      applications:      "Apex prepared a workflow plan.",
      bulk_application:  "Apex is preparing your bulk application queue.",
      company:           "Apex surfaced company intelligence.",
      research:          "Apex is running your research task.",
      outreach:          "Apex prepared your outreach draft.",
      interview:          "Apex generated your interview prep plan.",
      career_strategy:    "Apex analysed your career profile and directions.",
      autonomous_hunt:    "Apex built a live hunt plan around your lane, queue, and execution pressure.",
      offer_negotiation:  "Apex benchmarked your offer and prepared negotiation guidance.",
      salary_coaching:    "Apex analysed your salary targeting against market rates.",
      burnout_checkin:    "Apex checked in on your search.",
      post_hire_checkin:  "Apex opened your employer check-in.",
      personal_brand:     "Apex analysed your brand visibility.",
      jd_decoder:         "Apex is reading between the lines of this job posting.",
      reputation_guard:   "Apex is scoring this employer's reputation before you apply.",
      pipeline_sim:       "Apex ran your job search through a probability simulation.",
      shadow_network:     "Apex found warm referral paths in your network.",
      auto_apply:         "Set your 1-click apply rules — Apex prepares matching applications for your review.",
      idle:               "",
    }
    return labels[mode] ?? ""
  }
  const sentence = answer.split(/\.[\s\n]/)[0]
  return sentence.length <= 140 ? sentence : `${sentence.slice(0, 137)}…`
}

function hasMeaningfulApexPayload(response: ApexResponse): boolean {
  return Boolean(
    response.actions?.length ||
    response.workspace_directive ||
    response.workflow_directive ||
    response.workflow ||
    response.compare ||
    response.interviewPrep ||
    response.graph ||
    response.outreach ||
    response.apply_agent ||
    response.gated
  )
}

function isSoftFailureResponse(response: ApexResponse): boolean {
  if (hasMeaningfulApexPayload(response)) return false

  const answer = response.answer?.trim() ?? ""
  if (!answer) return true

  return [
    /encountered an error/i,
    /please try again/i,
    /taking too long/i,
    /temporarily unavailable/i,
    /returned an unexpected response/i,
    /could not respond right now/i,
    /response was cut off/i,
    /unable to .* right now/i,
  ].some((pattern) => pattern.test(answer))
}

/** Render **bold** markdown inline as <strong> elements. */
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{part}</strong> : part
  )
}

type TimelineSignalDetail = Partial<Omit<ApexTimelineEvent, "id" | "timestamp">> & {
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

function proactiveCommandSuggestion(event: ApexProactiveEvent): string {
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

function continuationContextKey(context: ApexResumableContext): string {
  return `${context.type}:${context.id}`
}

function toSpokenText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function openContinuationPrompt(context: ApexResumableContext): string {
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

function readTrimmedParam(searchParams: ReturnType<typeof useSearchParams>, key: string): string | undefined {
  const value = searchParams.get(key)?.trim()
  return value || undefined
}

export function ApexWorkspaceShell() {
  const pathname   = usePathname()
  const router = useRouter()
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

  // ── Apex streaming ─────────────────────────────────────────────────────────
  const apexStream    = useApexStream()
  const streamMsgId    = useRef<string | null>(null)
  const isSubmittingRef = useRef(false)   // sync guard — prevents double-submit within same tick

  // Refs for timeline change detection (avoid duplicate event emission)
  const prevModeRef          = useRef<WorkspaceMode>("idle")
  // Always-current workspace mode (for reading inside async stream callbacks)
  const workspaceModeRef     = useRef<WorkspaceMode>("idle")
  // Set when the current turn was an explicit 1-click/auto-apply intent — the
  // self-contained panel must not be overridden by Claude's response mode.
  const forceAutoApplyRef    = useRef(false)
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
  const handledWorkspaceDeepLinkRef = useRef<string | null>(null)
  const bulkHydrationSeqRef = useRef(0)
  const commandStartedAtRef  = useRef<number | null>(null)
  const pendingVoiceReplyRef = useRef(false)
  const lastCommandLatencyRef = useRef<number | null>(null)
  const lastDebugRef = useRef<ApexResponse["debug"] | null>(null)
  const planTwinRefreshTimerRef = useRef<number | null>(null)

  // ── Research streaming ──────────────────────────────────────────────────────
  const researchStream = useResearchStream()

  // ── Career strategy ─────────────────────────────────────────────────────────
  const careerStrategy = useCareerStrategy()
  const autonomousHunt = useAutonomousHunt()

  // ── Activity timeline ───────────────────────────────────────────────────────
  const timeline       = useApexTimeline()
  // Unified contextual side panel — replaces the always-on right rail
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [contextPanelTab, setContextPanelTab]   = useState<ContextPanelTab>("context")
  const openContextPanel = useCallback((tab: ContextPanelTab) => {
    setContextPanelTab(tab)
    setContextPanelOpen(true)
  }, [])
  const closeContextPanel = useCallback(() => setContextPanelOpen(false), [])
  // Restored research task — used by session replay when research mode is re-entered
  const [restoredResearchTask, setRestoredResearchTask] = useState<ApexResearchTask | null>(null)

  // ── Active browser context (from extension) ─────────────────────────────────
  const { context: browserContext, isExtensionConnected } = useActiveBrowserContext()

  // ── Search profile (persistent lightweight memory) ──────────────────────────
  const [searchProfile, setSearchProfile] = useState<ApexSearchProfile | null>(null)

  // ── Market intelligence signals ─────────────────────────────────────────────
  const [marketSignals,   setMarketSignals]   = useState<MarketSignal[]>([])
  const [marketLoading,   setMarketLoading]   = useState(true)

  // ── Permission gate (shell-level — handles events from any executor) ─────────
  const [activeGate,        setActiveGate]        = useState<import("@/components/apex/ApexActionGate").GateRequest | null>(null)
  const [showPermissions,   setShowPermissions]   = useState(false)
  const [memoryPanelOpen,   setMemoryPanelOpen]   = useState(false)
  const [shellPermissions,  setShellPermissions]  = useState<ApexPermissionState[]>(() => readPermissions())

  // ── Extension promo state — loaded after mount to avoid hydration mismatch ──
  const [extPromoDismissed, setExtPromoDismissed] = useState(false)
  useEffect(() => {
    setExtPromoDismissed(isExtPromosDismissed())
  }, [])

  const showExtPromo = !isExtensionConnected && !extPromoDismissed && APEX_FLAGS.extensionBridgeEnabled

  const handleDismissExtPromo = useCallback(() => {
    dismissExtPromo()
    setExtPromoDismissed(true)
  }, [])

  // ── Browser operator — must be after browserContext, isExtensionConnected, shellPermissions ──
  const operator = useApexBrowserOperator({
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
  const [activeResponse,  setActiveResponse]  = useState<ApexResponse | null>(null)
  const [rail,            setRail]            = useState<WorkspaceRail | null>(null)
  const [chips,           setChips]           = useState<string[]>([])
  const [activeEntities,  setActiveEntities]  = useState<ActiveEntities>({})
  const [narrative,        setNarrative]        = useState<string>("")
  const [narrativeDismissed, setNarrativeDismissed] = useState(false)
  const [paletteOpen,      setPaletteOpen]      = useState(false)
  const [applyAgent,       setApplyAgent]       = useState<ApplyAgentDirective | null>(null)

  // ── Session state ───────────────────────────────────────────────────────────
  const [recentCommands, setRecentCommands] = useState<string[]>([])
  const [hasSession,     setHasSession]     = useState(false)
  const [dismissedContinuationIds, setDismissedContinuationIds] = useState<Set<string>>(new Set())

  // ── Strategy / behavior data ────────────────────────────────────────────────
  const [strategyBoard,   setStrategyBoard]   = useState<ApexStrategyBoard | null>(null)
  const [strategyLoading, setStrategyLoading] = useState(true)
  const [behaviorSignals, setBehaviorSignals] = useState<ApexBehaviorSignals | null>(null)
  const [behaviorLoading, setBehaviorLoading] = useState(true)
  const [outcomeLearning, setOutcomeLearning] = useState<OutcomeLearningResult | null>(null)
  const [careerTwin, setCareerTwin] = useState<CareerTwinSnapshot | null>(null)
  const [careerTwinHistory, setCareerTwinHistory] = useState<CareerTwinSnapshot[]>([])
  const [careerTwinLoading, setCareerTwinLoading] = useState(true)
  const [careerTwinRefreshing, setCareerTwinRefreshing] = useState(false)
  const [careerTwinError, setCareerTwinError] = useState<string | null>(null)

  // ── Daily missions ──────────────────────────────────────────────────────────
  const [missionStore, setMissionStore] = useState<ApexMissionStore | null>(null)

  // ── Derived ─────────────────────────────────────────────────────────────────
  const apexMode = detectApexMode(pathname ?? "")

  const clearPendingStreamBubble = useCallback(() => {
    const streamId = streamMsgId.current
    if (!streamId) return
    setMessages((prev) => prev.filter((message) => message.id !== streamId))
    streamMsgId.current = null
  }, [])

  const enterRecoveryState = useCallback((message: string) => {
    commandStartedAtRef.current = null
    pendingVoiceReplyRef.current = false
    isSubmittingRef.current = false
    setIsLoading(false)
    setError(message)
    setWorkspaceMode("idle")
    setActiveResponse(null)
    setNarrative("")
    setNarrativeDismissed(false)
    setRail(null)
    clearPendingStreamBubble()
  }, [clearPendingStreamBubble])

  // Focus mode persists across navigation: read from URL param (when on /dashboard)
  // OR from localStorage (when the user navigated back to /dashboard/apex).
  // Start as false on both server and client to prevent SSR hydration mismatch;
  // a useEffect syncs the real localStorage value after hydration.
  const [localFocusMode, setLocalFocusMode] = useState(false)
  const isFocusMode = searchParams.get("focus") === "1" || localFocusMode

  // Sync localStorage → state when the URL focus param changes
  // Read localStorage after hydration (safe — runs only on client)
  useEffect(() => {
    try {
      const stored = localStorage.getItem("hireoven:apex-focus-mode:v1") === "1"
      if (stored) setLocalFocusMode(true)
    } catch {}
  }, [])

  // (e.g. user visits /dashboard?focus=1 and then navigates to Apex)
  useEffect(() => {
    if (searchParams.get("focus") === "1") {
      try { localStorage.setItem("hireoven:apex-focus-mode:v1", "1") } catch {}
      setLocalFocusMode(true)
    }
  }, [searchParams])

  // Sync focus mode state when the executor turns it off (same-tab event)
  // or when another tab clears localStorage (storage event)
  useEffect(() => {
    function onFocusChanged(e: Event) {
      const detail = (e as CustomEvent<{ enabled: boolean }>).detail
      setLocalFocusMode(detail.enabled)
    }
    function onStorage(e: StorageEvent) {
      if (e.key === "hireoven:apex-focus-mode:v1") {
        setLocalFocusMode(e.newValue === "1")
      }
    }
    window.addEventListener("apex:focus-mode-changed", onFocusChanged)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener("apex:focus-mode-changed", onFocusChanged)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const nudges: ApexNudge[] = useMemo(() => {
    if (!strategyBoard || !behaviorSignals) return []
    return getApexNudges(apexMode, behaviorSignals, strategyBoard, {
      isFocusMode,
      resumeId: primaryResume?.id ?? null,
    })
  }, [strategyBoard, behaviorSignals, apexMode, isFocusMode, primaryResume?.id])

  const contextIds = {
    jobId:         searchParams.get("jobId")         ?? undefined,
    companyId:     searchParams.get("companyId")     ?? undefined,
    resumeId:      searchParams.get("resumeId")      ?? undefined,
    applicationId: searchParams.get("applicationId") ?? undefined,
  }

  useEffect(() => {
    if (searchParams.get("mode") !== "shadow_network") return

    const companyName = readTrimmedParam(searchParams, "companyName") ?? readTrimmedParam(searchParams, "company")
    const jobTitle    = readTrimmedParam(searchParams, "jobTitle")
    const jobId       = readTrimmedParam(searchParams, "jobId")
    const companyId   = readTrimmedParam(searchParams, "companyId")
    const deepLinkKey = JSON.stringify({ mode: "shadow_network", companyName, jobTitle, jobId, companyId })

    if (handledWorkspaceDeepLinkRef.current === deepLinkKey) return
    handledWorkspaceDeepLinkRef.current = deepLinkKey

    setWorkspaceMode("shadow_network")
    setActiveEntities((prev) => ({
      ...prev,
      ...(companyName ? { companyName } : {}),
      ...(jobTitle ? { jobTitle } : {}),
      ...(jobId ? { jobId } : {}),
      ...(companyId ? { companyId } : {}),
    }))
    setNarrative(companyName
      ? `Shadow Network is ready to scan contacts at ${companyName}.`
      : "Shadow Network is ready to scan contacts."
    )
    setNarrativeDismissed(false)
    setError(null)
  }, [searchParams])

  const fullName  = profile?.full_name ?? user?.user_metadata?.full_name ?? null
  // Capitalize — profiles often store the name lowercased, and "Good morning,
  // felix" reads as a bug (welcome-screen review #9).
  const firstName = fullName?.split(" ")[0]?.replace(/^\p{L}/u, (c) => c.toUpperCase()) ?? "there"
  // Compute greeting client-side only — server UTC hour differs from client local
  // hour causing a text content hydration mismatch.
  const [greeting, setGreeting] = useState("Good morning")
  useEffect(() => {
    const h = new Date().getHours()
    setGreeting(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening")
  }, [])

  const speakApexReply = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return
    const spoken = toSpokenText(text).slice(0, 420)
    if (!spoken) return
    try {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(spoken)
      utterance.lang = "en-US"
      utterance.rate = 1
      utterance.pitch = 1
      window.speechSynthesis.speak(utterance)
    } catch {
      // Voice reply is best-effort and should never block Apex UX.
    }
  }, [])

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [])

  const proactive = useApexProactive({
    marketSignals,
    outcomeLearning,
    searchProfile,
    behaviorSignals,
    activeWorkflow: workflowEngine.activeWorkflow,
    bulkQueue: bulkEngine.queue,
  })

  const continuation = useApexContinuation()

  const loadCareerTwin = useCallback(async (options?: { rebuild?: boolean }) => {
    const shouldRebuild = options?.rebuild === true

    if (shouldRebuild) {
      setCareerTwinRefreshing(true)
    } else {
      setCareerTwinLoading(true)
    }

    setCareerTwinError(null)

    try {
      if (shouldRebuild) {
        const rebuildRes = await fetch("/api/apex/career-twin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ reason: "manual_refresh" }),
        })

        if (!rebuildRes.ok) {
          const payload = (await rebuildRes.json().catch(() => null)) as { error?: string } | null
          throw new Error(payload?.error ?? "Unable to rebuild Career Twin right now.")
        }
      }

      const res = await fetch("/api/apex/career-twin?fresh=1&history=1&hours=24", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      })

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? "Unable to load Career Twin right now.")
      }

      const data = (await res.json().catch(() => null)) as {
        twin?: CareerTwinSnapshot | null
        history?: CareerTwinSnapshot[]
      } | null

      setCareerTwin(data?.twin ?? null)
      setCareerTwinHistory(data?.history ?? [])
    } catch (error) {
      setCareerTwinError(error instanceof Error ? error.message : "Unable to load Career Twin right now.")
      if (!shouldRebuild) {
        setCareerTwin(null)
        setCareerTwinHistory([])
      }
    } finally {
      setCareerTwinLoading(false)
      setCareerTwinRefreshing(false)
    }
  }, [])

  const scheduleCareerTwinRebuildFromPlan = useCallback(() => {
    if (typeof window === "undefined") return

    if (planTwinRefreshTimerRef.current !== null) {
      window.clearTimeout(planTwinRefreshTimerRef.current)
    }

    planTwinRefreshTimerRef.current = window.setTimeout(() => {
      planTwinRefreshTimerRef.current = null
      void loadCareerTwin({ rebuild: true })
    }, 700)
  }, [loadCareerTwin])

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && planTwinRefreshTimerRef.current !== null) {
        window.clearTimeout(planTwinRefreshTimerRef.current)
      }
    }
  }, [])

  // ── Gate event bus — listens for permission requests from any executor ────────
  useEffect(() => {
    function onGateOpen(e: Event) {
      const detail = (e as CustomEvent).detail
      setActiveGate(detail)
    }
    window.addEventListener("apex:gate-open", onGateOpen)
    return () => window.removeEventListener("apex:gate-open", onGateOpen)
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
  }, [bulkEngine, timeline])

  // ── External timeline signals ───────────────────────────────────────────────
  // Child components can emit lightweight timeline-safe events through this bus.
  useEffect(() => {
    function onTimelineSignal(e: Event) {
      const detail = (e as CustomEvent<TimelineSignalDetail>).detail
      if (!detail || typeof detail !== "object") return
      if (typeof detail.type !== "string") return
      if (typeof detail.title !== "string" || !detail.title.trim()) return

      timeline.append({
        type: detail.type as ApexTimelineEvent["type"],
        title: detail.title,
        summary: typeof detail.summary === "string" ? detail.summary : undefined,
        timestamp: detail.timestamp ?? new Date().toISOString(),
        severity: detail.severity ?? "info",
        replayable: detail.replayable,
        replayAction: detail.replayAction,
        metadata: IS_DEV ? detail.metadata : undefined,
      })
    }

    window.addEventListener("apex:timeline-signal", onTimelineSignal as EventListener)
    return () => window.removeEventListener("apex:timeline-signal", onTimelineSignal as EventListener)
  }, [timeline])

  // ── Apex action audit bridge → timeline ───────────────────────────────────
  useEffect(() => {
    function onActionRecorded(e: Event) {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail
      const actionType = typeof detail?.actionType === "string" ? detail.actionType : null
      const label = typeof detail?.label === "string" ? detail.label : null
      if (!actionType || !label) return

      let type: ApexTimelineEvent["type"] = "workflow_step"
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

    window.addEventListener("apex:action-recorded", onActionRecorded as EventListener)
    return () => window.removeEventListener("apex:action-recorded", onActionRecorded as EventListener)
  }, [timeline])

  function dispatchGateResponse(approved: boolean, alwaysAllow = false) {
    setActiveGate(null)
    window.dispatchEvent(new CustomEvent("apex:gate-response", {
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
    window.addEventListener("apex:memory-cleared", onMemoryCleared)
    return () => window.removeEventListener("apex:memory-cleared", onMemoryCleared)
  }, [])

  useEffect(() => {
    void loadCareerTwin()
  }, [loadCareerTwin])

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
        const personalChips = getPersonalizedChips(apexMode, searchProfile)
        if (personalChips.length > 0) base = personalChips
      }
    }

    if (query.trim().length > 0 || !proactiveChip) return base
    if (base.includes(proactiveChip)) return base
    return [proactiveChip, ...base].slice(0, 5)
  }, [workspaceMode, hasSession, browserContext, searchProfile, apexMode, chips, proactiveChip, query])

  // ── Adaptive command bar placeholder ────────────────────────────────────────
  const commandBarPlaceholder = useMemo(() => {
    if (workspaceMode !== "idle") {
      if (workspaceMode === "search")  return "Refine this search…"
      if (workspaceMode === "compare") return "Ask about this comparison…"
      return "Follow up with Apex…"
    }
    return getContextualPlaceholder(
      browserContext,
      "Ask Apex anything…  (/ or ⌘K for commands)",
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

  const generatedResumableContexts = useMemo<ApexResumableContext[]>(() => {
    const nowIso = new Date().toISOString()
    const contexts: ApexResumableContext[] = []

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
    workflowEngine.activeWorkflow,
    activeResponse?.compare,
    workspaceMode,
    activeEntities.jobId,
    activeEntities.jobTitle,
    activeEntities.companyId,
    activeEntities.companyName,
    researchStream.task,
    restoredResearchTask,
    bulkEngine.queue,
  ])

  const continuationContexts = useMemo(() => {
    const source = continuation.state?.resumableContexts ?? []
    return source.filter((context) => !dismissedContinuationIds.has(continuationContextKey(context)))
  }, [continuation.state?.resumableContexts, dismissedContinuationIds])

  // ── Session restore ─────────────────────────────────────────────────────────
  // We intentionally do NOT restore session.mode here. The persisted session
  // covers chips/rail/recent commands only — `messages` and `activeResponse`
  // are deliberately excluded (see lib/apex/session.ts header). Restoring a
  // non-idle mode without the response stranded the UI in a permanent
  // "Scanning jobs for you..." skeleton state because the render branch
  // below has no signal that the mode is stale rather than mid-stream.
  // Recent commands + chips are enough re-entry context; the user re-fires
  // their last command if they want the mode-specific view back.
  useEffect(() => {
    const session = readApexSession()
    if (!session) { setChips(getApexSuggestionChips(apexMode)); return }
    setHasSession(true)
    setRecentCommands(session.recentCommands)
    setChips(session.chips.length > 0 ? session.chips : getApexSuggestionChips(apexMode))
    if (session.rail) setRail({ title: session.rail.title, summary: session.rail.summary })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!hasSession) setChips(getApexSuggestionChips(apexMode))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apexMode])

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
      clearApexSession()
      setMessages([]); setError(null); setActiveResponse(null)
      setWorkspaceMode("idle"); setRail(null); setNarrative("")
      setActiveEntities({}); setRecentCommands([]); setHasSession(false)
    }
    window.addEventListener("apex:reset-context", onReset)
    return () => window.removeEventListener("apex:reset-context", onReset)
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
    fetch("/api/apex/strategy", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { board?: ApexStrategyBoard } | undefined
        if (!cancelled) setStrategyBoard(data?.board ?? null)
      })
      .catch(() => { if (!cancelled) setStrategyBoard(null) })
      .finally(() => { if (!cancelled) setStrategyLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setMarketLoading(true)
    fetch("/api/apex/market", { cache: "no-store", headers: { Accept: "application/json" } })
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
    fetch("/api/apex/behavior", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { signals?: ApexBehaviorSignals | null } | undefined
        if (!cancelled) setBehaviorSignals(data?.signals ?? null)
      })
      .catch(() => { if (!cancelled) setBehaviorSignals(null) })
      .finally(() => { if (!cancelled) setBehaviorLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/apex/outcomes", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as OutcomeLearningResult | null
        if (!cancelled) setOutcomeLearning(data)
      })
      .catch(() => { if (!cancelled) setOutcomeLearning(null) })
    return () => { cancelled = true }
  }, [])

  // ── Company intel — fetched when company context changes ───────────────────────
  const [companyIntelData, setCompanyIntelData] = useState<{
    intel: import("@/lib/apex/company-intel/types").CompanyIntel
    summary: import("@/lib/apex/company-intel/types").CompanyIntelSummary
    companyName: string
  } | null>(null)
  const [companyIntelLoading, setCompanyIntelLoading] = useState(false)

  useEffect(() => {
    const cid = activeEntities?.companyId
    if (!cid) { setCompanyIntelData(null); return }
    let cancelled = false
    setCompanyIntelLoading(true)
    fetch(`/api/apex/company-intel/${cid}`)
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

    // Reduce mission count for users with a slowed/stalled search pace
    let missionLimit = 3
    fetch("/api/apex/burnout")
      .then((r) => r.ok ? r.json() : null)
      .then((d: { state?: { state?: string; intervention_type?: string } } | null) => {
        const pace = d?.state?.state
        if (pace === "stalled" || pace === "burnt_out") missionLimit = 2
      })
      .catch(() => {})

    const missions      = generateDailyMissions(ctx, missionLimit)
    const momentumLine  = buildMomentumLine(ctx)
    const store: ApexMissionStore = {
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
    if (!id || !apexStream.isStreaming) return
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, role: "apex_streaming" as const, streamText: apexStream.streamText } : m
      )
    )
  }, [apexStream.streamText, apexStream.isStreaming])

  // When the full response arrives, replace the streaming bubble with the final one
  useEffect(() => {
    const id = streamMsgId.current
    if (!apexStream.finalResponse || !id) return
    const normalized = apexStream.finalResponse
    if (commandStartedAtRef.current) {
      lastCommandLatencyRef.current = Date.now() - commandStartedAtRef.current
      commandStartedAtRef.current = null
    }
    lastDebugRef.current = normalized.debug ?? null

    // ── Quality Control pass ─────────────────────────────────────────────────
    // Run before setActiveResponse so every downstream consumer sees the
    // validated, repaired response. Context flags are best-effort — undefined
    // means "unknown / don't enforce that rule".
    const qcCtx = buildQCContext({
      hasMatchScore:       typeof normalized.confidence === "number" && normalized.confidence > 0,
      userRequestedReset:  /\b(reset|clear|start\s+fresh|start\s+over)\b/i.test(query),
      renderContext:       "dashboard",
    })
    const { safeResponse, issues: qcIssues } = runQualityControl(normalized, qcCtx)
    if (qcIssues.length > 0 && process.env.NODE_ENV === "development") {
      console.warn("[Apex QC] Shell:", qcIssues)
    }

    if (isSoftFailureResponse(safeResponse)) {
      const failureMessage = safeResponse.answer?.trim() || "Apex could not complete that request."
      timeline.append({
        type: "error",
        title: "Apex returned a fallback response",
        summary: failureMessage.length > 120 ? `${failureMessage.slice(0, 120)}…` : failureMessage,
        timestamp: new Date().toISOString(),
        severity: "error",
        metadata: IS_DEV
          ? {
              source: "soft_failure_response",
              debugOnly: true,
            }
          : undefined,
      })

      enterRecoveryState(failureMessage)
      return
    }

    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { id, role: "apex" as const, response: safeResponse } : m
      )
    )
    isSubmittingRef.current = false; setIsLoading(false)
    setActiveResponse(safeResponse)

    const directive = safeResponse.workspace_directive
    let newMode   = directive?.mode ?? inferWorkspaceMode(safeResponse)
    // If this turn was an explicit 1-click/auto-apply request, the self-contained
    // config panel is authoritative — Claude's response mode must not override it.
    if (forceAutoApplyRef.current) {
      newMode = "auto_apply"
      forceAutoApplyRef.current = false
    }
    setWorkspaceMode(newMode)
    if (newMode !== "idle") setNarrative(buildNarrative(newMode, safeResponse))
    setActiveEntities((prev) => extractEntities(safeResponse, prev))

    const profileUpdate = extractProfileUpdate(safeResponse, "")
    if (Object.keys(profileUpdate).length > 0) {
      setSearchProfile((prev) => {
        const updated = mergeProfileUpdate(prev, profileUpdate)
        writeSearchProfile(updated)
        return updated
      })
    }
    if (newMode === "bulk_application") {
      if (bulkEngine.isConfirming) bulkEngine.cancelConfirm()

      const bp = directive?.payload ?? {}
      const count = typeof bp.count === "number" ? bp.count : 10
      const minMatchScore = typeof bp.minMatchScore === "number" ? bp.minMatchScore : undefined
      const requireSponsorshipSignal = Boolean(bp.requireSponsorshipSignal)
      const workMode = typeof bp.workMode === "string" ? bp.workMode : undefined
      const strictQuery = Boolean(bp.strictQuery)
      const strictScoreOnly = Boolean(bp.strictScoreOnly)

      const selectorCriteria = {
        minMatchScore,
        requireSponsorshipSignal,
        workMode,
        strictQuery,
        strictScoreOnly,
        count,
      }
      const runSeq = ++bulkHydrationSeqRef.current

      // Always prefer apply-agent UX. If the server didn't hydrate it in /chat,
      // recover by selecting jobs client-side with identical criteria.
      if (safeResponse.apply_agent) {
        setApplyAgent({
          jobs: safeResponse.apply_agent.jobs ?? [],
          criteria: {
            minMatchScore:
              typeof safeResponse.apply_agent.criteria?.minMatchScore === "number"
                ? safeResponse.apply_agent.criteria.minMatchScore
                : selectorCriteria.minMatchScore,
            requireSponsorshipSignal:
              typeof safeResponse.apply_agent.criteria?.requireSponsorshipSignal === "boolean"
                ? safeResponse.apply_agent.criteria.requireSponsorshipSignal
                : selectorCriteria.requireSponsorshipSignal,
            workMode:
              typeof safeResponse.apply_agent.criteria?.workMode === "string"
                ? safeResponse.apply_agent.criteria.workMode
                : selectorCriteria.workMode,
            strictQuery:
              typeof safeResponse.apply_agent.criteria?.strictQuery === "boolean"
                ? safeResponse.apply_agent.criteria.strictQuery
                : selectorCriteria.strictQuery,
            strictScoreOnly:
              typeof safeResponse.apply_agent.criteria?.strictScoreOnly === "boolean"
                ? safeResponse.apply_agent.criteria.strictScoreOnly
                : selectorCriteria.strictScoreOnly,
            count:
              typeof safeResponse.apply_agent.criteria?.count === "number"
                ? safeResponse.apply_agent.criteria.count
                : selectorCriteria.count,
          },
          currentIndex:
            typeof safeResponse.apply_agent.currentIndex === "number"
              ? safeResponse.apply_agent.currentIndex
              : 0,
          phase: safeResponse.apply_agent.phase ?? "select",
        })
      } else {
        const params = new URLSearchParams()
        params.set("count", String(selectorCriteria.count))
        if (typeof selectorCriteria.minMatchScore === "number") {
          params.set("minMatchScore", String(selectorCriteria.minMatchScore))
        }
        if (selectorCriteria.requireSponsorshipSignal) params.set("sponsorship", "true")
        if (selectorCriteria.workMode) params.set("workMode", selectorCriteria.workMode)
        if (selectorCriteria.strictQuery) params.set("strictQuery", "true")
        if (selectorCriteria.strictScoreOnly) params.set("strictScoreOnly", "true")
        params.set("freshnessHours", "24")
        if (query.trim().length > 0) params.set("q", query.trim())

        void (async () => {
          try {
            const res = await fetch(`/api/apex/apply-agent?${params.toString()}`, {
              headers: { Accept: "application/json" },
            })
            const data = (await res.json().catch(() => null)) as { jobs?: ApplyAgentDirective["jobs"] } | null
            if (bulkHydrationSeqRef.current !== runSeq) return
            setApplyAgent({
              jobs: data?.jobs ?? [],
              criteria: selectorCriteria,
              currentIndex: 0,
              phase: "select",
            })
          } catch {
            if (bulkHydrationSeqRef.current !== runSeq) return
            setApplyAgent({
              jobs: [],
              criteria: selectorCriteria,
              currentIndex: 0,
              phase: "select",
            })
          }
        })()
      }
    } else {
      bulkHydrationSeqRef.current += 1
      setApplyAgent(null)
    }
    if (safeResponse.workflow_directive && newMode !== "bulk_application") {
      workflowEngine.startWorkflow(safeResponse.workflow_directive.workflowType, safeResponse.workflow_directive.payload)
    }
    const railActions = safeResponse.actions?.filter((a) => ["OPEN_JOB","OPEN_COMPANY","OPEN_RESUME_TAILOR"].includes(a.type))
    const newRail = directive?.rail !== undefined ? (directive.rail ?? null) : railActions?.length ? { title: "Apex context", summary: "Suggested next steps", actions: railActions } : null
    setRail(newRail)
    if (directive?.chips?.length) setChips(directive.chips)
    const updatedCmds = appendCommand(recentCommands, "")
    setHasSession(true)
    writeApexSession({ mode: newMode, chips: directive?.chips ?? chips, recentCommands: updatedCmds, rail: extractRailMetadata(newRail), modeMetadata: extractModeMetadata(newMode, safeResponse) })
    streamMsgId.current = null

    if (pendingVoiceReplyRef.current) {
      pendingVoiceReplyRef.current = false
      const responseText = safeResponse.answer?.trim() || buildNarrative(newMode, safeResponse)
      if (responseText) speakApexReply(responseText)
    }
  // This effect must only process a newly completed stream payload once.
  // Re-running on other changing references would duplicate state transitions.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apexStream.finalResponse, enterRecoveryState])

  // Handle stream errors
  useEffect(() => {
    if (!apexStream.error || apexStream.isStreaming) return
    lastDebugRef.current = null
    enterRecoveryState(apexStream.error)
  }, [apexStream.error, apexStream.isStreaming, enterRecoveryState])

  // Research stream — task completion: persist, update chips, clear loading
  useEffect(() => {
    const task = researchStream.task
    if (!task || researchStream.isRunning) return
    isSubmittingRef.current = false; setIsLoading(false)
    clearPendingStreamBubble()
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
      enterRecoveryState("Research could not produce findings. Try a more specific query.")
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchStream.isRunning, clearPendingStreamBubble, enterRecoveryState])

  // Research stream error
  useEffect(() => {
    if (!researchStream.error) return
    enterRecoveryState(researchStream.error)
  }, [researchStream.error, enterRecoveryState])

  // Career strategy — data loaded
  useEffect(() => {
    if (careerStrategy.loading) return
    isSubmittingRef.current = false; setIsLoading(false)
    clearPendingStreamBubble()
    if (careerStrategy.data) {
      const dirCount = careerStrategy.data.directions.length
      if (dirCount > 0) {
        setNarrative(`Found ${dirCount} career direction${dirCount !== 1 ? "s" : ""} — review below`)
        setChips(["Compare these directions", "What skills should I prioritize?", "Queue matching jobs"])
      }
    }
    if (careerStrategy.error) {
      enterRecoveryState(careerStrategy.error)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerStrategy.loading, careerStrategy.data, careerStrategy.error, clearPendingStreamBubble, enterRecoveryState])

  // Autonomous Hunt — planner loaded
  useEffect(() => {
    if (autonomousHunt.loading) return
    isSubmittingRef.current = false
    setIsLoading(false)

    clearPendingStreamBubble()

    if (autonomousHunt.data) {
      setError(null)
      setNarrative("Autonomous Hunt ranked the live queue and prepared your attack plan.")
      setChips([
        "Run autonomous hunt for sponsorship-friendly roles matching my profile",
        "Show recent high-match postings only and rank them by fit",
        "What should I do next across my applications?",
      ])
      setHasSession(true)
      return
    }

    if (autonomousHunt.error) {
      enterRecoveryState(autonomousHunt.error)
    }
  }, [autonomousHunt.loading, autonomousHunt.data, autonomousHunt.error, clearPendingStreamBubble, enterRecoveryState])

  // ── Timeline tracking effects ───────────────────────────────────────────────
  // Each effect uses a ref to detect meaningful changes so events are never
  // duplicated. These effects are purely observational — they never modify
  // any Apex state.

  // Keep the always-current mode ref in sync for async stream callbacks
  useEffect(() => { workspaceModeRef.current = workspaceMode }, [workspaceMode])

  // 1. Workspace mode changes (skip idle — it's the default/return state)
  useEffect(() => {
    if (workspaceMode === prevModeRef.current || workspaceMode === "idle") {
      prevModeRef.current = workspaceMode
      return
    }
    prevModeRef.current = workspaceMode
    const LABELS: Partial<Record<WorkspaceMode, string>> = {
      search:           "Apex switched to job search view",
      compare:          "Apex opened job comparison",
      tailor:           "Apex opened resume tailoring",
      applications:     "Apex opened application workflow",
      bulk_application: "Apex opened bulk application queue",
      company:          "Apex opened company intelligence",
      research:         "Apex started a research task",
      autonomous_hunt:  "Apex opened your autonomous hunt plan",
    }
    const replayAction: ApexTimelineReplayAction | undefined =
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
      summary:   activeGate.description || "Awaiting your approval before Apex proceeds",
      timestamp: new Date().toISOString(),
      severity:  "warning",
      metadata:  IS_DEV ? { permission: key, debugOnly: true } : undefined,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGate])

  // 6. Errors
  useEffect(() => {
    const err = apexStream.error ?? researchStream.error
    if (!err) return
    timeline.append({
      type:      "error",
      title:     "Apex encountered an error",
      summary:   err.length > 120 ? `${err.slice(0, 120)}…` : err,
      timestamp: new Date().toISOString(),
      severity:  "error",
      metadata: IS_DEV
        ? {
            source: apexStream.error ? "apex_stream" : "research_stream",
            debugOnly: true,
          }
        : undefined,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apexStream.error, researchStream.error])

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
      // Auto-start sequential apply: open the first ready job's review drawer and
      // its application tab so the user can begin filling without a manual click.
      const firstReady = queue.jobs.find(
        (j) => j.status === "ready" || j.status === "needs_review"
      )
      if (firstReady) {
        bulkEngine.openReview(firstReady.queueId)
        if (firstReady.applyUrl) window.open(firstReady.applyUrl, "_blank", "noopener,noreferrer")
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulkEngine.queue?.id, bulkEngine.queue?.jobs, bulkEngine.queue?.completedAt])

  // Early workspace directive — morph before Claude finishes
  useEffect(() => {
    if (!apexStream.earlyDirective) return
    const mode = apexStream.earlyDirective.mode ?? "idle"
    if (mode !== "idle") setWorkspaceMode(mode)
  }, [apexStream.earlyDirective])

  useEffect(() => {
    if (workspaceMode !== "autonomous_hunt") return
    if (autonomousHunt.loading || autonomousHunt.data || autonomousHunt.error) return
    void autonomousHunt.generate("Run autonomous hunt for today")
  }, [workspaceMode, autonomousHunt, autonomousHunt.loading, autonomousHunt.data, autonomousHunt.error, autonomousHunt.generate])

  // ── Submit ───────────────────────────────────────────────────────────────────

  const handleSubmit = useCallback(
    async (
      event: React.FormEvent,
      overrideMessage?: string,
      source: "typed" | "voice" = "typed"
    ) => {
      event.preventDefault()
      const message = (overrideMessage ?? query).trim()
      if (!message || isSubmittingRef.current || isLoading || apexStream.isStreaming || researchStream.isRunning) return

      const careerSiteUrl = extractCareerSiteUrlFromMessage(message)
      if (careerSiteUrl) {
        pendingVoiceReplyRef.current = false
        setQuery("")
        const updatedCmds = appendCommand(recentCommands, message)
        setRecentCommands(updatedCmds)
        setHasSession(true)
        router.push(`/dashboard/site-scout?url=${encodeURIComponent(careerSiteUrl)}`)
        return
      }

      const executableMessage = resolveExecutableApexCommand(message)
      isSubmittingRef.current = true
      pendingVoiceReplyRef.current = source === "voice"

      const msgId = `s-${Date.now()}`
      streamMsgId.current = msgId

      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", text: message },
        { id: msgId, role: "apex_streaming", streamText: "" },
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

      if (isAutonomousHuntIntent(executableMessage)) {
        pendingVoiceReplyRef.current = false
        setWorkspaceMode("autonomous_hunt")
        setNarrative(PREFLIGHT_NARRATIVE.autonomous_hunt ?? "")
        void autonomousHunt.generate(executableMessage)
        const updatedCmds = appendCommand(recentCommands, message)
        setRecentCommands(updatedCmds)
        setHasSession(true)
        return
      }

      // ── Career strategy — before research (research RE also catches career phrases) ──
      if (isCareerStrategyIntent(executableMessage)) {
        pendingVoiceReplyRef.current = false
        setWorkspaceMode("career_strategy")
        setNarrative(PREFLIGHT_NARRATIVE.career_strategy ?? "")
        careerStrategy.reset()
        void careerStrategy.generate(executableMessage)
        const updatedCmds = appendCommand(recentCommands, message)
        setRecentCommands(updatedCmds)
        setHasSession(true)
        return
      }

      // ── Research intent — route to research endpoint, not chat ────────────
      if (isResearchIntent(executableMessage)) {
        pendingVoiceReplyRef.current = false
        setWorkspaceMode("research")
        setNarrative(PREFLIGHT_NARRATIVE.research ?? "")
        researchStream.reset()
        void researchStream.startStream("/api/apex/research", {
          message: executableMessage,
          ...contextIds,
        })
        const updatedCmds = appendCommand(recentCommands, message)
        setRecentCommands(updatedCmds)
        setHasSession(true)
        return
      }

      // ── Pre-flight: morph workspace immediately before network call ────────
      const preflightMode = detectPreflightMode(executableMessage)
      forceAutoApplyRef.current = preflightMode === "auto_apply"
      if (preflightMode) {
        setWorkspaceMode(preflightMode)
        const preflightNarrative = PREFLIGHT_NARRATIVE[preflightMode]
        if (preflightNarrative) setNarrative(preflightNarrative)
      }

      // ── Start SSE stream ───────────────────────────────────────────────────
      void apexStream.startStream("/api/apex/chat", {
        message: executableMessage, pagePath: pathname, commandMode: true, focusMode: isFocusMode,
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

  const handleVoiceCommand = useCallback((spokenMessage: string) => {
    const message = spokenMessage.trim()
    if (!message) return
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent
    void handleSubmit(fakeEvent, message, "voice")
  }, [handleSubmit])

  function runCommandNow(command: string) {
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent
    void handleSubmit(fakeEvent, command)
  }
  function prefillOrRunCommand(command: string) {
    const executable = resolveExecutableApexCommand(command)
    if (isAutonomousHuntIntent(executable)) {
      runCommandNow(command)
      return
    }
    setQuery(command)
    setTimeout(() => inputRef.current?.focus(), 50)
  }
  function handleChipClick(chip: string) { prefillOrRunCommand(chip) }
  function handleFollowUp(text: string)  { prefillOrRunCommand(text) }
  function handleSendCommand(query: string) { prefillOrRunCommand(query) }

  function handleOpenProactive(event: ApexProactiveEvent) {
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
  function handleReplay(action: ApexTimelineReplayAction) {
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
    clearApexSession()
    setMessages([]); setError(null); setActiveResponse(null)
    setWorkspaceMode("idle"); setRail(null); setNarrative(""); setActiveEntities({})
    setRecentCommands([]); setHasSession(false); setChips(getApexSuggestionChips(apexMode))
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  const showNarrative = narrative && !narrativeDismissed && workspaceMode !== "idle"
  const narrativePending = isLoading || apexStream.isStreaming || researchStream.isRunning || careerStrategy.loading || autonomousHunt.loading
  // Welcome state: clean centered hero — hide top command bar / chips / proactive strip
  const isWelcomeState =
    workspaceMode === "idle" &&
    messages.length === 0 &&
    !isLoading &&
    !apexStream.isStreaming &&
    !researchStream.isRunning
  // Derived: has the user accumulated any job/application data yet?
  const hasData = (strategyBoard?.snapshot?.savedJobs ?? 0) > 0
                  || (strategyBoard?.snapshot?.activeApplications ?? 0) > 0
                  || hasSession
  const showProactiveStrip =
    proactive.settings.enabled &&
    workspaceMode === "idle" &&
    messages.length > 0 &&             // suppress on the clean welcome hero
    !isLoading &&
    !apexStream.isStreaming &&
    !researchStream.isRunning &&
    query.trim().length === 0 &&
    Boolean(proactive.topEvent)
  const showIdleStoryScene =
    workspaceMode === "idle" &&
    (apexStream.isStreaming || researchStream.isRunning)
  const showWorkspaceLeftRail = workspaceMode !== "idle"

  const MODE_DISPLAY_LABELS: Partial<Record<WorkspaceMode, string>> = {
    search:           "Job Search",
    compare:          "Comparing Jobs",
    tailor:           "Resume Tailoring",
    applications:     "Applications",
    company:          "Company Intel",
    bulk_application: "Bulk Apply",
    research:         "Deep Research",
    outreach:         "Outreach",
    interview:        "Interview Prep",
    career_strategy:  "Career Strategy",
    autonomous_hunt:  "Autonomous Hunt",
  }

  const workspaceModeLabel =
    MODE_DISPLAY_LABELS[workspaceMode] ??
    (workspaceMode === "idle"
      ? "Ready"
      : workspaceMode.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))

  const statusLine = apexStream.isStreaming
    ? "Thinking…"
    : researchStream.isRunning
      ? "Researching…"
      : workspaceMode === "idle"
        ? ""
        : workspaceModeLabel

  return (
    <main className="app-page flex flex-col" style={{ background: "linear-gradient(160deg, #F8FAFC 0%, #F1F5F9 46%, #EEF2FF 100%)" }}>

      {/* ── Command bar — sticky ─────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/97 px-5 shadow-[0_1px_0_rgba(0,0,0,0.04)] backdrop-blur-md sm:px-8">
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <div>
              <div className="flex items-center gap-1.5">
                <ApexIcon size={18} glow={false} />
                <p className="text-[14px] font-bold leading-none tracking-tight text-slate-900">Apex</p>
              </div>
              {/* Subtitle fades in on key change when mode transitions */}
              {statusLine && (
                <p
                  key={statusLine}
                  className={cn(
                    "mt-0.5 text-[11px] font-medium motion-safe:animate-[apexSubtitleIn_0.3s_ease-out_both]",
                    (apexStream.isStreaming || researchStream.isRunning)
                      ? "text-slate-600"
                      : workspaceMode === "idle"
                        ? "font-normal text-slate-400"
                        : "text-slate-600"
                  )}
                >
                  {statusLine}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Streaming stop button */}
            {(apexStream.isStreaming || researchStream.isRunning) && (
              <button
                type="button"
                onClick={researchStream.isRunning ? researchStream.cancel : apexStream.cancel}
                title="Stop Apex"
                className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-500 transition hover:bg-red-100"
              >
                Stop
              </button>
            )}
            {/* Focus mode badge */}
            {isFocusMode && (
              <button
                type="button"
                title="Focus Mode is on — click to turn off"
                onClick={() => {
                  try { localStorage.removeItem("hireoven:apex-focus-mode:v1") } catch {}
                  setLocalFocusMode(false)
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("apex:focus-mode-changed", { detail: { enabled: false } }))
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                <Target className="h-3 w-3" />
                Focus
                <X className="h-2.5 w-2.5 opacity-60" />
              </button>
            )}
            {/* Mode pill */}
            {workspaceMode !== "idle" && !apexStream.isStreaming && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2563EB]" />
                {workspaceModeLabel}
              </span>
            )}
            {/* Menu button */}
            <button
              type="button"
              onClick={() => openContextPanel("context")}
              title="Apex menu"
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-lg transition",
                contextPanelOpen
                  ? "bg-slate-50 text-slate-600"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Command bar hides in welcome state — moved into the centered hero */}
        {!isWelcomeState && (
          <ApexCommandBar
            query={query} onChange={setQuery} onSubmit={handleSubmit}
            onVoiceCommand={handleVoiceCommand}
            isLoading={isLoading} chips={displayChips} onChipClick={handleChipClick}
            inputRef={inputRef} variant="light" commandHistory={recentCommands}
            onOpenPalette={() => setPaletteOpen(true)}
            placeholder={commandBarPlaceholder}
          />
        )}
        <div className="h-2.5" />
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
      <div className="flex flex-1 overflow-hidden">

        {/* Left intelligence panel */}
        {showWorkspaceLeftRail && (
          <ApexLeftPanel
            isActive={apexStream.isStreaming || researchStream.isRunning || isLoading}
            recentEvents={timeline.events}
            onCommand={prefillOrRunCommand}
          />
        )}

        {/* Center — scrollable main content */}
        <div className="min-w-0 flex-1 overflow-y-auto px-5 py-5 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5.5rem))] sm:px-8">

          {/* Real-time alert badge — floats above proactive strip */}
          <ApexAlertBadge className="mb-2" />

          {/* Proactive companion strip (non-intrusive, idle only) */}
          {showProactiveStrip && (
            <ApexProactiveStrip
              event={proactive.topEvent}
              enabled={proactive.settings.enabled}
              onOpen={handleOpenProactive}
              onDismiss={proactive.dismiss}
              onSnooze={proactive.snooze}
              onDisable={() => proactive.setEnabled(false)}
            />
          )}

          {/* Apex narrative strip */}
          {showNarrative && (
            <div
              className={`group relative mb-4 flex items-center gap-3 overflow-hidden rounded-xl border px-4 py-2.5 transition-colors ${
                narrativePending
                  ? "border-slate-200 bg-gradient-to-r from-orange-50/30 via-orange-50 to-orange-50/30"
                  : "border-slate-100 bg-slate-50/55"
              }`}
            >
              {narrativePending && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full animate-[apex-shimmer_2.2s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/55 to-transparent"
                />
              )}

              <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
                {narrativePending && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-[#2563EB]/25" />
                )}
                <Sparkles
                  className={`relative h-3.5 w-3.5 text-slate-600 ${
                    narrativePending ? "animate-[apex-pulse_1.8s_ease-in-out_infinite]" : ""
                  }`}
                />
              </span>

              <p className="relative flex-1 text-sm leading-5 text-slate-700">
                {narrativePending ? (
                  <span className="bg-gradient-to-r from-slate-700 via-[#2563EB] to-slate-700 bg-[length:200%_100%] bg-clip-text text-transparent animate-[apex-text-shimmer_2.4s_linear_infinite]">
                    {renderBold(narrative.replace(/…+$/, ""))}
                  </span>
                ) : (
                  renderBold(narrative)
                )}
                {narrativePending && (
                  <span className="ml-0.5 inline-flex translate-y-[-1px] gap-0.5 align-middle">
                    <span className="h-1 w-1 animate-[apex-dot_1.2s_ease-in-out_infinite] rounded-full bg-[#2563EB]" />
                    <span className="h-1 w-1 animate-[apex-dot_1.2s_ease-in-out_0.18s_infinite] rounded-full bg-[#2563EB]" />
                    <span className="h-1 w-1 animate-[apex-dot_1.2s_ease-in-out_0.36s_infinite] rounded-full bg-[#2563EB]" />
                  </span>
                )}
              </p>

              <button
                type="button"
                onClick={() => setNarrativeDismissed(true)}
                className="relative flex-shrink-0 rounded-md p-1 text-slate-400 transition hover:bg-white/60 hover:text-slate-600"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Apex learned — lightweight memory chips, idle only */}
          {showWorkspaceLeftRail && searchProfile && (() => {
            const memChips = buildMemoryChips(searchProfile)
            if (!memChips.length) return null
            return (
              <div className="mb-4">
                <ApexMemoryChips
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
                    window.dispatchEvent(new CustomEvent("apex:memory-cleared"))
                  }}
                />
              </div>
            )
          })()}

          {/* WorkspaceSurface — smooth opacity fade between modes */}
          <ApexErrorBoundary surface="Workspace" retryLabel="Reload workspace">
          <WorkspaceSurface
            mode={workspaceMode}
            render={(displayedMode) => {
              if (displayedMode === "idle") {
                if (showIdleStoryScene) {
                  const lastUserMessage = messages.findLast((m) => m.role === "user")
                  return (
                    <ApexStoryScene
                      command={lastUserMessage?.role === "user" ? lastUserMessage.text : undefined}
                      narrative={narrative}
                      mode={workspaceMode}
                      streamText={apexStream.streamText}
                    />
                  )
                }
                // No conversation yet → premium welcome scene (story-mode aesthetic)
                if (messages.length === 0 && !isLoading) {
                  return (
                    <ApexWelcomeScene
                      greeting={greeting}
                      firstName={firstName}
                      hasResume={Boolean(primaryResume?.id)}
                      hasData={hasData}
                      isExtensionConnected={isExtensionConnected}
                      onSuggestionClick={prefillOrRunCommand}
                      onRunCommand={runCommandNow}
                      strategyBoard={strategyBoard}
                      strategyLoading={strategyLoading || behaviorLoading}
                      nudges={nudges}
                      careerTwin={careerTwin}
                      careerTwinHistory={careerTwinHistory}
                      careerTwinLoading={careerTwinLoading}
                      careerTwinRefreshing={careerTwinRefreshing}
                      careerTwinError={careerTwinError}
                      onRefreshCareerTwin={() => {
                        void loadCareerTwin({ rebuild: true })
                      }}
                      onOpenPlanHistory={() => openContextPanel("plan")}
                      onPlanStateCommitted={scheduleCareerTwinRebuildFromPlan}
                      commandSlot={
                        <ApexCommandBar
                          query={query}
                          onChange={setQuery}
                          onSubmit={handleSubmit}
                          onVoiceCommand={handleVoiceCommand}
                          isLoading={isLoading}
                          chips={[]}
                          onChipClick={handleChipClick}
                          inputRef={inputRef}
                          variant="light"
                          commandHistory={recentCommands}
                          onOpenPalette={() => setPaletteOpen(true)}
                          placeholder={commandBarPlaceholder}
                        />
                      }
                    />
                  )
                }
                return (
                  <IdleMode
                    greeting={greeting} firstName={firstName} messages={messages}
                    isLoading={isLoading} error={error} nudges={nudges}
                    strategyLoading={strategyLoading || behaviorLoading}
                    resumeRefreshedNotice={resumeRefreshedNotice}
                    onClearChat={handleClearChat}
                    onTileClick={prefillOrRunCommand}
                    onRunCommand={runCommandNow}
                    chatEndRef={chatEndRef as React.RefObject<HTMLDivElement>}
                    recentCommands={recentCommands} hasSession={hasSession}
                    onStartFresh={handleStartFresh}
                    userInitial={firstName ? firstName.charAt(0).toUpperCase() : undefined}
                    missions={missionStore?.disabled ? [] : (missionStore?.missions ?? [])}
                    momentumLine={missionStore?.momentumLine}
                    onMissionLaunch={prefillOrRunCommand}
                    onMissionDismiss={(id) => {
                      setMissionStore((prev) => prev ? patchMissionStatus(prev, id, "dismissed") : prev)
                    }}
                    onMissionsDisable={() => {
                      setMissionsDisabled(true)
                      setMissionStore((prev) => prev ? { ...prev, disabled: true } : prev)
                    }}
                    showExtensionPromo={showExtPromo}
                    hasData={hasData}
                    onDismissExtPromo={handleDismissExtPromo}
                    strategyBoard={strategyBoard}
                    careerTwin={careerTwin}
                    careerTwinHistory={careerTwinHistory}
                    careerTwinLoading={careerTwinLoading}
                    careerTwinRefreshing={careerTwinRefreshing}
                    careerTwinError={careerTwinError}
                    onRefreshCareerTwin={() => {
                      void loadCareerTwin({ rebuild: true })
                    }}
                    onOpenPlanHistory={() => openContextPanel("plan")}
                    onPlanStateCommitted={scheduleCareerTwinRebuildFromPlan}
                  />
                )
              }
              // Non-idle mode with no response yet → show skeleton ONLY while
              // a request is actually in flight. Without this guard, returning
              // to /dashboard/apex after navigating away strands the UI in a
              // permanent "Scanning..." state when workspaceMode is non-idle
              // but no stream/load is active.
              if (!activeResponse) {
                const canRenderWithoutActiveResponse =
                  displayedMode === "bulk_application" ||
                  displayedMode === "company" ||
                  displayedMode === "research" ||
                  displayedMode === "career_strategy" ||
                  displayedMode === "autonomous_hunt" ||
                  displayedMode === "jd_decoder" ||
                  displayedMode === "reputation_guard" ||
                  displayedMode === "pipeline_sim" ||
                  displayedMode === "shadow_network" ||
                  displayedMode === "auto_apply"

                if (canRenderWithoutActiveResponse) {
                  // Let the mode-specific branches below render from their own
                  // state instead of forcing the shell back into IdleMode.
                } else {
                const isActuallyWorking =
                  isLoading || apexStream.isStreaming || researchStream.isRunning
                  if (!isActuallyWorking) {
                    return (
                      <IdleMode
                        greeting={greeting} firstName={firstName} messages={messages}
                        isLoading={isLoading} error={error} nudges={nudges}
                        strategyLoading={strategyLoading || behaviorLoading}
                      resumeRefreshedNotice={resumeRefreshedNotice}
                      onClearChat={handleClearChat}
                      onTileClick={prefillOrRunCommand}
                      onRunCommand={runCommandNow}
                        chatEndRef={chatEndRef as React.RefObject<HTMLDivElement>}
                        recentCommands={recentCommands} hasSession={hasSession}
                        onStartFresh={handleStartFresh}
                        userInitial={firstName ? firstName.charAt(0).toUpperCase() : undefined}
                      missions={missionStore?.disabled ? [] : (missionStore?.missions ?? [])}
                      momentumLine={missionStore?.momentumLine}
                      onMissionLaunch={prefillOrRunCommand}
                        onMissionDismiss={(id) => {
                          setMissionStore((prev) => prev ? patchMissionStatus(prev, id, "dismissed") : prev)
                        }}
                        onMissionsDisable={() => {
                          setMissionsDisabled(true)
                          setMissionStore((prev) => prev ? { ...prev, disabled: true } : prev)
                        }}
                        showExtensionPromo={showExtPromo}
                        hasData={hasData}
                        onDismissExtPromo={handleDismissExtPromo}
                        strategyBoard={strategyBoard}
                        careerTwin={careerTwin}
                        careerTwinHistory={careerTwinHistory}
                        careerTwinLoading={careerTwinLoading}
                        careerTwinRefreshing={careerTwinRefreshing}
                        careerTwinError={careerTwinError}
                        onRefreshCareerTwin={() => {
                          void loadCareerTwin({ rebuild: true })
                        }}
                        onOpenPlanHistory={() => openContextPanel("plan")}
                        onPlanStateCommitted={scheduleCareerTwinRebuildFromPlan}
                      />
                    )
                  }
                  const lastMsg = messages.findLast?.((m) => m.role === "user")
                  return (
                    <ApexThinkingCanvas
                      workspaceMode={displayedMode}
                      lastUserMessage={lastMsg?.role === "user" ? lastMsg.text : undefined}
                      narrative={narrative}
                    />
                  )
                }
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
                // If Apex selected specific jobs server-side, use the agentic loop
                if (applyAgent && applyAgent.jobs.length > 0) {
                  return (
                    <ApplyAgentFlow
                      initialJobs={applyAgent.jobs}
                      extensionConnected={isExtensionConnected}
                      requireSponsorshipSignal={Boolean(applyAgent.criteria.requireSponsorshipSignal)}
                      onFollowUp={(q) => { setQuery(q); setTimeout(() => handleSubmit({ preventDefault: () => {} } as React.FormEvent), 50) }}
                    />
                  )
                }
                // Searched but found nothing — tell the user explicitly
                if (applyAgent && applyAgent.jobs.length === 0) {
                  return (
                    <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-amber-50 px-6 py-8 text-center">
                      <p className="text-[15px] font-semibold text-amber-900">No matching jobs found in the feed</p>
                      <p className="mt-2 text-[13px] text-amber-800 leading-relaxed">
                        No active jobs from the last 24 hours matched your criteria. Try broadening the search — for example, drop the company filter or use a more general skill.
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {["Apply to my top 5 matches", "Apply to 3 remote jobs", "Apply to 5 software engineer roles"].map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => { setQuery(suggestion); setTimeout(() => handleSubmit({ preventDefault: () => {} } as React.FormEvent), 50) }}
                            className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-medium text-amber-900 transition hover:bg-amber-100"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                }
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
                    onCommand={prefillOrRunCommand}
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
                    onCommand={prefillOrRunCommand}
                  />
                )
              }
              if (displayedMode === "autonomous_hunt") {
                return (
                  <AutonomousHuntMode
                    data={autonomousHunt.data}
                    loading={autonomousHunt.loading}
                    error={autonomousHunt.error}
                    onCommand={runCommandNow}
                    onRefresh={() => { void autonomousHunt.refresh() }}
                  />
                )
              }
              if (displayedMode === "jd_decoder") {
                const jobTitle = activeEntities?.jobTitle ?? activeResponse?.workspace_directive?.payload?.jobTitle as string ?? "Unknown Role"
                const jobDesc  = activeResponse?.workspace_directive?.payload?.jobDescription as string ?? ""
                return (
                  <JDDecoderPanel
                    title={jobTitle}
                    description={jobDesc}
                    className="w-full"
                  />
                )
              }
              if (displayedMode === "reputation_guard") {
                const companyName = activeEntities?.companyName ?? activeResponse?.workspace_directive?.payload?.companyName as string ?? ""
                const jobTitle    = activeEntities?.jobTitle    ?? ""
                return (
                  <ReputationGuardPanel
                    companyName={companyName}
                    jobTitle={jobTitle}
                    className="w-full"
                  />
                )
              }
              if (displayedMode === "pipeline_sim") {
                return <PipelineSimulator className="w-full" />
              }
              if (displayedMode === "shadow_network") {
                const companyName = activeEntities?.companyName ?? ""
                const jobTitle    = activeEntities?.jobTitle    ?? "Software Engineer"
                return (
                  <ShadowNetworkMode
                    targetCompany={companyName}
                    targetJobTitle={jobTitle}
                    extensionConnected={isExtensionConnected}
                    className="w-full"
                  />
                )
              }
              if (displayedMode === "auto_apply") {
                return (
                  <AutoApplyPanel
                    extensionConnected={isExtensionConnected}
                    onFollowUp={(q) => { setQuery(q); setTimeout(() => handleSubmit({ preventDefault: () => {} } as React.FormEvent), 50) }}
                    className="w-full"
                  />
                )
              }
              // Fallback for restored session with no activeResponse
              return null
            }}
          />
          </ApexErrorBoundary>
        </div>

      </div>

      {/* ── Unified contextual side panel — replaces the always-on right rail ── */}
      <ApexErrorBoundary surface="Context panel" retryLabel="Reload panel">
        <ApexContextPanel
          open={contextPanelOpen}
          tab={contextPanelTab}
          onTabChange={setContextPanelTab}
          onClose={closeContextPanel}

          timelineEvents={timeline.events}
          onClearTimeline={timeline.clear}
          onReplay={handleReplay}
          isDev={IS_DEV}

          companyId={activeEntities?.companyId}
          companyName={activeEntities?.companyName ?? companyIntelData?.companyName}
          companyIntel={companyIntelData?.intel ?? null}
          companySummary={companyIntelData?.summary ?? null}
          companyLoading={companyIntelLoading}
          onCloseCompany={() => setCompanyIntelData(null)}

          browserContext={browserContext}
          activeWorkflow={workflowEngine.activeWorkflow}
          latestRailEvents={latestRailEvents}
          proactiveRailEvents={proactiveRailEvents}
          onPreFill={(query) => {
            if (/autofill/i.test(query) && browserContext?.pageType === "application_form") {
              operator.execute("prepare_autofill", {
                context: { company: browserContext.company, atsProvider: browserContext.atsProvider },
              })
            }
            handleSendCommand(query)
          }}
          onExpandWorkflow={() => workflowEngine.setExpanded(true)}
          onOpenProactive={handleOpenProactive}

          proactiveEvents={proactiveRailEvents}
          proactiveEnabled={proactive.settings.enabled}
          proactiveMutedCount={proactive.settings.mutedTypes.length}
          proactiveLoading={proactive.loading}
          onDismissProactive={proactive.dismiss}
          onSnoozeProactive={proactive.snooze}
          onMuteProactiveType={proactive.muteType}
          onClearMutedTypes={proactive.clearMutedTypes}
          onSetProactiveEnabled={proactive.setEnabled}

          marketSignals={marketSignals}
          marketLoading={marketLoading}

          workflowState={workflowEngine.activeWorkflow}
          onContinueStep={() => {
            const stepId = workflowEngine.activeWorkflow?.activeStepId
            if (stepId) workflowEngine.continueStep(stepId)
          }}
          onSkipStep={() => {
            const stepId = workflowEngine.activeWorkflow?.activeStepId
            if (stepId) workflowEngine.skipStep(stepId)
          }}
          onPauseWorkflow={workflowEngine.pauseWorkflow}
          onResumeWorkflow={workflowEngine.resumeWorkflow}
          onCancelWorkflow={workflowEngine.cancelWorkflow}

          onOpenMemory={() => { closeContextPanel(); setMemoryPanelOpen(true) }}
          onOpenPermissions={() => { closeContextPanel(); setShowPermissions(true) }}
          permissions={shellPermissions}
        />
      </ApexErrorBoundary>
      {/* ── Command palette ──────────────────────────────────────────── */}
      <ApexCommandPalette
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
            prefillOrRunCommand(paletteQuery)
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
        <ApexActionGate
          gate={activeGate}
          onAllowOnce={() => dispatchGateResponse(true, false)}
          onAlwaysAllow={() => dispatchGateResponse(true, true)}
          onCancel={() => dispatchGateResponse(false)}
        />
      )}

      {/* ── Permissions panel — bottom-right slide-in ───────────────── */}
      {showPermissions && (
        <ApexPermissionsPanel
          permissions={shellPermissions}
          onPermissionsChange={setShellPermissions}
          onClose={() => setShowPermissions(false)}
        />
      )}

      {/* ── Apex Memory panel ──────────────────────────────────────────── */}
      {memoryPanelOpen && (
        <ApexMemoryPanel onClose={() => setMemoryPanelOpen(false)} />
      )}

      {/* ── Bulk confirm dialog — modal, shown immediately on trigger ── */}
      {bulkEngine.isConfirming && (
        <BulkConfirmDialog
          jobs={bulkEngine.confirmJobs}
          onConfirm={bulkEngine.confirmStart}
          onEditList={bulkEngine.cancelConfirm}
          onCancel={bulkEngine.cancelConfirm}
          onRemoveJob={bulkEngine.removeConfirmJob}
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
            onAdvance={() => {
              // Sequential apply: after submit/skip, open the next ready job automatically.
              // Runs synchronously within the user gesture so window.open is never blocked.
              const jobs = bulkEngine.queue?.jobs ?? []
              const currentIdx = jobs.findIndex((j) => j.queueId === bulkEngine.reviewingQueueId)
              const next = jobs.slice(currentIdx + 1).find(
                (j) => j.status === "ready" || j.status === "needs_review"
              )
              bulkEngine.closeReview()
              if (next) {
                bulkEngine.openReview(next.queueId)
                if (next.applyUrl) window.open(next.applyUrl, "_blank", "noopener,noreferrer")
              }
            }}
            onOpenApp={(applyUrl, _queueId) => window.open(applyUrl, "_blank", "noopener,noreferrer")}
            onMarkSubmitted={bulkEngine.markSubmitted}
            onSkip={bulkEngine.skipJob}
          />
        )
      })()}
    </main>
  )
}
