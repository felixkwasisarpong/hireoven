/**
 * Scout Cross-Device Continuity — Types V1
 *
 * Privacy contract:
 * - Never include sensitive autofill values
 * - Never include raw resume/application answer content
 * - Never include raw page HTML
 *
 * Continuity payload should remain lightweight and human-reviewable.
 */

export type ScoutResumableContextType =
  | "workflow"
  | "compare"
  | "tailor"
  | "research"
  | "application_queue"

export type ScoutResumableContext = {
  type: ScoutResumableContextType
  id: string
  title: string
  updatedAt: string
}

export type ScoutContinuationState = {
  activeMode?: string
  activeWorkflowId?: string
  activeJobId?: string
  activeCompanyId?: string
  activeResearchId?: string

  recentCommands?: string[]

  resumableContexts?: ScoutResumableContext[]
}

export type ScoutContinuationApiResponse = {
  state: ScoutContinuationState | null
  updatedAt?: string | null
}
