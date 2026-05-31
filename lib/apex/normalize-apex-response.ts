/**
 * Apex Response Display Normalizer
 *
 * TWO-LAYER normalization:
 *   Layer 1 (lib/apex/normalize.ts)  — raw API JSON → typed ApexResponse
 *   Layer 2 (THIS FILE)               — ApexResponse → NormalizedApexResponse
 *
 * Layer 2 is purely for rendering:
 *   - Extracts safe display text (never raw JSON)
 *   - Separates structured payloads into typed display slots
 *   - Strips workspace/workflow directives from visible content
 *   - Optionally attaches the raw payload for dev debugging
 *
 * All UI surfaces MUST call normalizeForDisplay() before rendering.
 * No component should read response.answer directly.
 */

import type {
  ApexResponse,
  ApexRecommendation,
  ApexIntent,
  ApexMode,
  ApexAction,
  ApexExplanationBlock,
  ApexWorkflow,
  ApexCompareResponse,
  ApexInterviewPrep,
  ApexMockInterview,
  ApexWorkspaceDirective,
  ApexWorkflowDirective,
} from "@/lib/apex/types"
import type { ApexGraph } from "@/components/apex/renderers/ApexGraphRenderer"
import { getApexDisplayText } from "@/lib/apex/display-text"
import { runQualityControl, type QCContext } from "@/lib/apex/quality-control"

export type ApexRenderContext = "dashboard" | "mini" | "extension"

export type NormalizedApexResponse = {
  /** Safe, human-readable text — never raw JSON */
  displayText:        string

  recommendation:     ApexRecommendation
  intent?:            ApexIntent
  confidence?:        number
  mode?:              ApexMode

  actions:            ApexAction[]
  explanations:       ApexExplanationBlock[]
  workflow?:          ApexWorkflow
  compare?:           ApexCompareResponse
  interviewPrep?:     ApexInterviewPrep
  mockInterview?:     ApexMockInterview
  graph?:             ApexGraph
  gated?:             ApexResponse["gated"]

  /**
   * workspace_directive and workflow_directive are NEVER rendered as visible
   * text. They are stripped here and retained only for dev inspection.
   */
  workspace_directive?: ApexWorkspaceDirective
  workflow_directive?:  ApexWorkflowDirective

  /** Dev-only: original response for debug panel */
  rawDebugPayload?: ApexResponse
}

const IS_DEV = false

export function normalizeForDisplay(
  response: ApexResponse,
  qcContext?: QCContext,
): NormalizedApexResponse {
  // Run QC pass before display normalisation so every rendering path —
  // dashboard shell, mini command bar, extension overlay — sees the same
  // validated and repaired response.
  const { safeResponse } = runQualityControl(response, qcContext ?? {})

  const displayText = getApexDisplayText(safeResponse.answer)

  return {
    displayText,
    recommendation:     safeResponse.recommendation,
    intent:             safeResponse.intent,
    confidence:         safeResponse.confidence,
    mode:               safeResponse.mode,
    actions:            safeResponse.actions ?? [],
    explanations:       safeResponse.explanations ?? [],
    workflow:           safeResponse.workflow,
    compare:            safeResponse.compare,
    interviewPrep:      safeResponse.interviewPrep,
    mockInterview:      safeResponse.mockInterview,
    graph:              safeResponse.graph,
    gated:              safeResponse.gated,
    workspace_directive: safeResponse.workspace_directive,
    workflow_directive:  safeResponse.workflow_directive,
    rawDebugPayload:    IS_DEV ? response : undefined,
  }
}

/** True when the normalized response has any structured content to render. */
export function hasStructuredContent(n: NormalizedApexResponse): boolean {
  return (
    n.explanations.length > 0 ||
    Boolean(n.compare) ||
    Boolean(n.interviewPrep) ||
    Boolean(n.workflow) ||
    Boolean(n.graph) ||
    n.actions.length > 0
  )
}
