/**
 * Scout Action Types - Phase 1.3: Safe UI Actions
 * 
 * Only non-destructive, navigation-based actions are allowed.
 */

export type ScoutActionType =
  | "OPEN_JOB"
  | "APPLY_FILTERS"
  | "OPEN_RESUME_TAILOR"
  | "HIGHLIGHT_JOBS"
  | "OPEN_COMPANY"
  | "SET_FOCUS_MODE"
  | "RESET_CONTEXT"
  // Phase 1.4 placeholder — triggers Chrome extension bridge from Scout chat.
  | "OPEN_EXTENSION_BRIDGE"
  // Phase 2 — instructs user to open autofill preview for the current application page.
  | "OPEN_EXTENSION_AUTOFILL_PREVIEW"
  // Phase 3 — full tailor-before-autofill flow: import job → tailor resume preview → autofill.
  | "PREPARE_TAILORED_AUTOFILL"

export const SCOUT_MODES = [
  "feed",
  "job",
  "resume",
  "applications",
  "company",
  "scout",
  "general",
] as const

export type ScoutMode = (typeof SCOUT_MODES)[number]

export function isScoutMode(value: unknown): value is ScoutMode {
  return typeof value === "string" && SCOUT_MODES.includes(value as ScoutMode)
}

export type ScoutAction =
  | {
      type: "OPEN_JOB"
      payload: { jobId: string }
      label?: string
    }
  | {
      type: "APPLY_FILTERS"
      payload: {
        query?: string
        location?: string
        workMode?: string
        sponsorship?: "high" | "moderate" | "low"
      }
      label?: string
    }
  | {
      type: "OPEN_RESUME_TAILOR"
      payload: {
        jobId?: string
        resumeId?: string
      }
      label?: string
    }
  | {
      type: "HIGHLIGHT_JOBS"
      payload: {
        jobIds: string[]
        reason?: string
      }
      label?: string
    }
  | {
      type: "OPEN_COMPANY"
      payload: { companyId: string }
      label?: string
    }
  | {
      type: "SET_FOCUS_MODE"
      payload: { enabled: boolean; reason?: string }
      label?: string
    }
  | {
      type: "RESET_CONTEXT"
      payload: { clearFilters?: boolean; reason?: string }
      label?: string
    }
  | {
      /**
       * Phase 1.4 placeholder.
       * Scout can suggest opening the extension bridge to capture a job from
       * an external site. The UI renders a prompt; no auto-apply occurs.
       */
      type: "OPEN_EXTENSION_BRIDGE"
      payload: { hint?: string }
      label?: string
    }
  | {
      /**
       * Phase 2 — instructs the user to open the Chrome extension autofill
       * preview on the active application form page.
       * Purely informational; the user controls all field filling.
       */
      type: "OPEN_EXTENSION_AUTOFILL_PREVIEW"
      payload: { hint?: string; url?: string }
      label?: string
    }
  | {
      /**
       * Phase 3 — full tailor-before-autofill flow.
       * Instructs the user to:
       *   1. Open the Hireoven extension on the job/application page.
       *   2. Click "Tailor Resume" to preview AI-suggested changes.
       *   3. Approve changes (creates a new resume version draft).
       *   4. Then proceed with autofill.
       * Scout cannot trigger the extension directly — this is a user-guided flow.
       */
      type: "PREPARE_TAILORED_AUTOFILL"
      payload: { jobId?: string; url?: string; hint?: string }
      label?: string
    }

export type ScoutRecommendation = "Apply" | "Skip" | "Improve" | "Wait" | "Explore"

export const SCOUT_INTENTS = ["question", "command", "workflow", "analysis", "interview_prep"] as const

export type ScoutIntent = (typeof SCOUT_INTENTS)[number]

export function isScoutIntent(value: unknown): value is ScoutIntent {
  return typeof value === "string" && SCOUT_INTENTS.includes(value as ScoutIntent)
}

export type ScoutStep = {
  id: string
  title: string
  description?: string
  action?: ScoutAction
}

export type ScoutWorkflow = {
  title: string
  steps: ScoutStep[]
}

export type ScoutExplanationBlockType =
  | "match_breakdown"
  | "resume_gap"
  | "sponsorship_signal"
  | "application_risk"
  | "next_action"
  | "evidence_bridge"

export type ScoutExplanationItemStatus =
  | "strong"
  | "medium"
  | "weak"
  | "missing"
  | "unknown"

export type ScoutEvidenceBridgeItemStatus = "strong" | "partial" | "missing" | "unknown"

export type ScoutEvidenceBridgeItem = {
  requirement: string
  resumeEvidence?: string
  status: ScoutEvidenceBridgeItemStatus
  suggestedFix?: string
}

export type ScoutEvidenceBridgeBlock = {
  type: "evidence_bridge"
  title: string
  summary?: string
  items: ScoutEvidenceBridgeItem[]
}

export type ScoutStandardExplanationBlock = {
  type: Exclude<ScoutExplanationBlockType, "evidence_bridge">
  title: string
  summary?: string
  items: Array<{
    label: string
    status?: ScoutExplanationItemStatus
    evidence?: string
    recommendation?: string
  }>
}

export type ScoutExplanationBlock = ScoutStandardExplanationBlock | ScoutEvidenceBridgeBlock

export type ScoutStrategyRiskSeverity = "low" | "medium" | "high"

export type ScoutStrategyRisk = {
  id: string
  title: string
  description: string
  severity: ScoutStrategyRiskSeverity
}

export type ScoutWeakSignalSeverity = "info" | "warning" | "opportunity"

export type ScoutWeakSignal = {
  id: string
  title: string
  description: string
  severity?: ScoutWeakSignalSeverity
}

export type ScoutStrategyMove = {
  id: string
  title: string
  description: string
  action?: ScoutAction
}

export type ScoutStrategyBoard = {
  todayFocus: string[]
  snapshot: {
    savedJobs: number
    activeApplications: number
    recentApplications: number
    averageMatchScore: number | null
  }
  risks: ScoutStrategyRisk[]
  nextMoves: ScoutStrategyMove[]
  weakSignals: ScoutWeakSignal[]
}

// ── Compare Mode ─────────────────────────────────────────────────────────────

export type ScoutCompareRecommendation = "Best" | "Good" | "Risky" | "Skip"

export type ScoutCompareItem = {
  jobId: string
  title: string
  company?: string
  /** Injected server-side from CompareJobContext — not returned by Claude */
  companyId?: string | null
  matchScore?: number | null
  sponsorshipSignal?: string | null
  salaryRange?: string | null
  location?: string | null
  riskSummary?: string
  recommendation?: ScoutCompareRecommendation
}

export type ScoutCompareResponse = {
  summary: string
  items: ScoutCompareItem[]
  winnerJobId?: string
  tradeoffs?: string[]
}

// ── Interview Prep ───────────────────────────────────────────────────────────

export type ScoutInterviewPrep = {
  roleFocus: string[]
  likelyTopics: string[]
  resumeTalkingPoints: string[]
  gapsToPrepare: string[]
  practiceQuestions: string[]
  companyNotes?: string[]
}

// ── Mock Interview ────────────────────────────────────────────────────────────

export type ScoutMockInterviewFeedback = {
  strengths: string[]
  improvements: string[]
  suggestedAnswer?: string
}

export type ScoutMockInterview = {
  sessionId: string
  mode: "text"
  jobId?: string
  currentQuestion: string
  questionIndex: number
  totalQuestions: number
  feedback?: ScoutMockInterviewFeedback
  isComplete: boolean
}

/** A single exchange stored client-side — sent back on every request. */
export type ScoutMockInterviewTurn = {
  question: string
  answer?: string
  feedback?: ScoutMockInterviewFeedback
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Workflow Directive ─────────────────────────────────────────────────────────

/**
 * When present in a ScoutResponse, the frontend should mount the workflow panel
 * and start tracking the named workflow type.
 * The backend infers this from intent + message keywords — Claude does not emit it directly.
 */
export type ScoutWorkflowDirective = {
  /** One of the known workflow types: tailor_and_prepare | compare_and_prioritize | interview_prep */
  workflowType: string
  /** Optional: a pre-assigned workflow ID for deduplication */
  workflowId?: string
  /** Context passed from the response (job ID, resume ID, etc.) */
  payload?: Record<string, unknown>
}

// ── Workspace Directive ────────────────────────────────────────────────────────

export type ScoutWorkspaceMode = "idle" | "search" | "compare" | "tailor" | "applications" | "bulk_application" | "company" | "research"

export type ScoutWorkspaceDirective = {
  /** Which workspace panel to activate. */
  mode: ScoutWorkspaceMode
  /** How the workspace should transition. Defaults to "replace". */
  transition?: "replace" | "push" | "slide-right" | "none"
  /** Arbitrary mode-specific payload for the workspace component. */
  payload?: Record<string, unknown>
  /**
   * Optional context rail to slide in alongside the workspace.
   * Null explicitly closes any open rail.
   */
  rail?: {
    title: string
    summary?: string
    actions?: ScoutAction[]
  } | null
  /** Follow-up suggestion chips relevant to the active mode. */
  chips?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────

export type ScoutResponse = {
  answer: string
  recommendation: ScoutRecommendation
  actions: ScoutAction[]
  explanations?: ScoutExplanationBlock[]
  workflow?: ScoutWorkflow
  intent?: ScoutIntent
  confidence?: number
  mode?: ScoutMode
  /** Optional structured graph payload — rendered by ScoutGraphRenderer, never shown as text */
  graph?: import("@/components/scout/renderers/ScoutGraphRenderer").ScoutGraph
  compare?: ScoutCompareResponse
  interviewPrep?: ScoutInterviewPrep
  mockInterview?: ScoutMockInterview
  gated?: {
    feature: import("@/lib/gates").FeatureKey
    reason: string
    upgradeMessage: string
  }
  /**
   * When present, the workspace shell uses this directive to switch modes
   * instead of inferring from the response shape. Frontend inference
   * remains as a fallback when this field is absent.
   */
  workspace_directive?: ScoutWorkspaceDirective
  /**
   * When present, the frontend mounts the workflow panel and starts tracking
   * the named multi-step workflow. Only emitted when intent === "workflow".
   */
  workflow_directive?: ScoutWorkflowDirective
}

/** AI-generated weekly strategy plan returned from Strategy Mode. */
export type ScoutAIStrategy = {
  /** 2–3 strategic themes for the week — where to direct energy */
  focus: string[]
  /** 2–3 specific opportunity types, companies, or signals to pursue first */
  prioritize: string[]
  /** 1–2 patterns or role types to stop spending time on */
  avoid: string[]
  /** 2–3 concrete resume/profile improvements with evidence from context */
  improve: string[]
  /** 3–4 completable tasks for this specific week */
  thisWeek: string[]
  /** 0–4 Scout UI actions to immediately execute the strategy */
  actions: ScoutAction[]
}

export type ScoutAIStrategyGated = {
  feature: import("@/lib/gates").FeatureKey
  upgradeMessage: string
  lockedSections: Array<"prioritize" | "avoid" | "improve">
}
