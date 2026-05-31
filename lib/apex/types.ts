/**
 * Apex Action Types - Phase 1.3: Safe UI Actions
 * 
 * Only non-destructive, navigation-based actions are allowed.
 */

export type ApexActionType =
  | "OPEN_JOB"
  | "APPLY_FILTERS"
  | "OPEN_RESUME_TAILOR"
  | "HIGHLIGHT_JOBS"
  | "OPEN_COMPANY"
  | "SET_FOCUS_MODE"
  | "RESET_CONTEXT"
  // Phase 1.4 placeholder — triggers Chrome extension bridge from Apex chat.
  | "OPEN_EXTENSION_BRIDGE"
  // Phase 2 — instructs user to open autofill preview for the current application page.
  | "OPEN_EXTENSION_AUTOFILL_PREVIEW"
  // Phase 3 — full tailor-before-autofill flow: import job → tailor resume preview → autofill.
  | "PREPARE_TAILORED_AUTOFILL"

export const APEX_MODES = [
  "feed",
  "job",
  "resume",
  "applications",
  "company",
  "apex",
  "general",
] as const

export type ApexMode = (typeof APEX_MODES)[number]

export function isApexMode(value: unknown): value is ApexMode {
  return typeof value === "string" && APEX_MODES.includes(value as ApexMode)
}

export type ApexAction =
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
       * Apex can suggest opening the extension bridge to capture a job from
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
       * Apex cannot trigger the extension directly — this is a user-guided flow.
       */
      type: "PREPARE_TAILORED_AUTOFILL"
      payload: { jobId?: string; url?: string; hint?: string }
      label?: string
    }

export type ApexRecommendation = "Apply" | "Skip" | "Improve" | "Wait" | "Explore"

export const APEX_INTENTS = ["question", "command", "workflow", "analysis", "interview_prep"] as const

export type ApexIntent = (typeof APEX_INTENTS)[number]

export function isApexIntent(value: unknown): value is ApexIntent {
  return typeof value === "string" && APEX_INTENTS.includes(value as ApexIntent)
}

export type ApexStep = {
  id: string
  title: string
  description?: string
  action?: ApexAction
}

export type ApexWorkflow = {
  title: string
  steps: ApexStep[]
}

export type ApexExplanationBlockType =
  | "match_breakdown"
  | "resume_gap"
  | "sponsorship_signal"
  | "application_risk"
  | "next_action"
  | "evidence_bridge"

export type ApexExplanationItemStatus =
  | "strong"
  | "medium"
  | "weak"
  | "missing"
  | "unknown"

export type ApexEvidenceBridgeItemStatus = "strong" | "partial" | "missing" | "unknown"

export type ApexEvidenceBridgeItem = {
  requirement: string
  resumeEvidence?: string
  status: ApexEvidenceBridgeItemStatus
  suggestedFix?: string
}

export type ApexEvidenceBridgeBlock = {
  type: "evidence_bridge"
  title: string
  summary?: string
  items: ApexEvidenceBridgeItem[]
}

export type ApexStandardExplanationBlock = {
  type: Exclude<ApexExplanationBlockType, "evidence_bridge">
  title: string
  summary?: string
  items: Array<{
    label: string
    status?: ApexExplanationItemStatus
    evidence?: string
    recommendation?: string
  }>
}

export type ApexExplanationBlock = ApexStandardExplanationBlock | ApexEvidenceBridgeBlock

export type ApexStrategyRiskSeverity = "low" | "medium" | "high"

export type ApexStrategyRisk = {
  id: string
  title: string
  description: string
  severity: ApexStrategyRiskSeverity
}

export type ApexWeakSignalSeverity = "info" | "warning" | "opportunity"

export type ApexWeakSignal = {
  id: string
  title: string
  description: string
  severity?: ApexWeakSignalSeverity
}

export type ApexStrategyMove = {
  id: string
  title: string
  description: string
  action?: ApexAction
}

export type ApexStrategyBoard = {
  todayFocus: string[]
  snapshot: {
    savedJobs: number
    activeApplications: number
    recentApplications: number
    averageMatchScore: number | null
  }
  risks: ApexStrategyRisk[]
  nextMoves: ApexStrategyMove[]
  weakSignals: ApexWeakSignal[]
}

// ── Compare Mode ─────────────────────────────────────────────────────────────

export type ApexCompareRecommendation = "Best" | "Good" | "Risky" | "Skip"

export type ApexCompareItem = {
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
  recommendation?: ApexCompareRecommendation
}

export type ApexCompareResponse = {
  summary: string
  items: ApexCompareItem[]
  winnerJobId?: string
  tradeoffs?: string[]
}

// ── Interview Prep ───────────────────────────────────────────────────────────

export type ApexInterviewPrep = {
  roleFocus: string[]
  likelyTopics: string[]
  resumeTalkingPoints: string[]
  gapsToPrepare: string[]
  practiceQuestions: string[]
  companyNotes?: string[]
}

// ── Mock Interview ────────────────────────────────────────────────────────────

export type ApexMockInterviewFeedback = {
  strengths: string[]
  improvements: string[]
  suggestedAnswer?: string
}

export type ApexMockInterview = {
  sessionId: string
  mode: "text"
  jobId?: string
  currentQuestion: string
  questionIndex: number
  totalQuestions: number
  feedback?: ApexMockInterviewFeedback
  isComplete: boolean
}

/** A single exchange stored client-side — sent back on every request. */
export type ApexMockInterviewTurn = {
  question: string
  answer?: string
  feedback?: ApexMockInterviewFeedback
}

// ─────────────────────────────────────────────────────────────────────────────

// ── Workflow Directive ─────────────────────────────────────────────────────────

/**
 * When present in a ApexResponse, the frontend should mount the workflow panel
 * and start tracking the named workflow type.
 * The backend infers this from intent + message keywords — Claude does not emit it directly.
 */
export type ApexWorkflowDirective = {
  /** One of the known workflow types: tailor_and_prepare | compare_and_prioritize | interview_prep */
  workflowType: string
  /** Optional: a pre-assigned workflow ID for deduplication */
  workflowId?: string
  /** Context passed from the response (job ID, resume ID, etc.) */
  payload?: Record<string, unknown>
}

// ── Workspace Directive ────────────────────────────────────────────────────────

export type ApexWorkspaceMode = "idle" | "search" | "compare" | "tailor" | "applications" | "bulk_application" | "company" | "research" | "outreach" | "interview" | "career_strategy" | "offer_negotiation" | "salary_coaching" | "burnout_checkin" | "post_hire_checkin" | "personal_brand" | "jd_decoder" | "reputation_guard" | "pipeline_sim" | "shadow_network" | "auto_apply"

export type ApexWorkspaceDirective = {
  /** Which workspace panel to activate. */
  mode: ApexWorkspaceMode
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
    actions?: ApexAction[]
  } | null
  /** Follow-up suggestion chips relevant to the active mode. */
  chips?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────

export type ApexResponse = {
  answer: string
  recommendation: ApexRecommendation
  actions: ApexAction[]
  explanations?: ApexExplanationBlock[]
  workflow?: ApexWorkflow
  intent?: ApexIntent
  confidence?: number
  mode?: ApexMode
  /** Optional structured graph payload — rendered by ApexGraphRenderer, never shown as text */
  graph?: import("@/components/apex/renderers/ApexGraphRenderer").ApexGraph
  compare?: ApexCompareResponse
  interviewPrep?: ApexInterviewPrep
  mockInterview?: ApexMockInterview
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
  workspace_directive?: ApexWorkspaceDirective
  /**
   * When present, the frontend mounts the workflow panel and starts tracking
   * the named multi-step workflow. Only emitted when intent === "workflow".
   */
  workflow_directive?: ApexWorkflowDirective
  /**
   * Recruiter copilot — generated outreach draft.
   * User reviews and edits before sending. Apex never sends automatically.
   */
  outreach?: import("@/lib/apex/outreach/types").ApexOutreachDraft
  /**
   * Apply agent — emitted when Apex selects jobs to apply to and drives
   * the tailor → confirm → apply loop. Never emitted for single-job flows.
   */
  apply_agent?: import("@/lib/apex/apply-agent/types").ApplyAgentDirective
  /**
   * Development-only diagnostics. Never render directly in user-facing UI.
   * Used for timeline metadata and local debugging of orchestrator behavior.
   */
  debug?: {
    orchestrator?: {
      intent?: string
      totalDurationMs?: number
      traces?: Array<{
        agentId: string
        durationMs: number
        success: boolean
        summary?: string
        error?: string
      }>
    }
    timing?: {
      responseMs?: number
    }
  }
}

/** AI-generated weekly strategy plan returned from Strategy Mode. */
export type ApexAIStrategy = {
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
  /** 0–4 Apex UI actions to immediately execute the strategy */
  actions: ApexAction[]
}

export type ApexAIStrategyGated = {
  feature: import("@/lib/gates").FeatureKey
  upgradeMessage: string
  lockedSections: Array<"prioritize" | "avoid" | "improve">
}
