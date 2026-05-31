/**
 * Apex Cross-Device Continuity — Types V1
 *
 * Privacy contract:
 * - Never include sensitive autofill values
 * - Never include raw resume/application answer content
 * - Never include raw page HTML
 *
 * Continuity payload should remain lightweight and human-reviewable.
 */

export type ApexResumableContextType =
  | "workflow"
  | "compare"
  | "tailor"
  | "research"
  | "application_queue"

export type ApexResumableContext = {
  type: ApexResumableContextType
  id: string
  title: string
  updatedAt: string
}

export type ApexContinuationState = {
  activeMode?: string
  activeWorkflowId?: string
  activeJobId?: string
  activeCompanyId?: string
  activeResearchId?: string

  recentCommands?: string[]

  resumableContexts?: ApexResumableContext[]
}

export type ApexContinuationApiResponse = {
  state: ApexContinuationState | null
  updatedAt?: string | null
}
