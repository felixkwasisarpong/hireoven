/**
 * Scout Response Display Normalizer
 *
 * TWO-LAYER normalization:
 *   Layer 1 (lib/scout/normalize.ts)  — raw API JSON → typed ScoutResponse
 *   Layer 2 (THIS FILE)               — ScoutResponse → NormalizedScoutResponse
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
  ScoutResponse,
  ScoutRecommendation,
  ScoutIntent,
  ScoutMode,
  ScoutAction,
  ScoutExplanationBlock,
  ScoutWorkflow,
  ScoutCompareResponse,
  ScoutInterviewPrep,
  ScoutMockInterview,
  ScoutWorkspaceDirective,
  ScoutWorkflowDirective,
} from "@/lib/scout/types"
import type { ScoutGraph } from "@/components/scout/renderers/ScoutGraphRenderer"
import { getScoutDisplayText } from "@/lib/scout/display-text"

export type ScoutRenderContext = "dashboard" | "mini" | "extension"

export type NormalizedScoutResponse = {
  /** Safe, human-readable text — never raw JSON */
  displayText:        string

  recommendation:     ScoutRecommendation
  intent?:            ScoutIntent
  confidence?:        number
  mode?:              ScoutMode

  actions:            ScoutAction[]
  explanations:       ScoutExplanationBlock[]
  workflow?:          ScoutWorkflow
  compare?:           ScoutCompareResponse
  interviewPrep?:     ScoutInterviewPrep
  mockInterview?:     ScoutMockInterview
  graph?:             ScoutGraph
  gated?:             ScoutResponse["gated"]

  /**
   * workspace_directive and workflow_directive are NEVER rendered as visible
   * text. They are stripped here and retained only for dev inspection.
   */
  workspace_directive?: ScoutWorkspaceDirective
  workflow_directive?:  ScoutWorkflowDirective

  /** Dev-only: original response for debug panel */
  rawDebugPayload?: ScoutResponse
}

const IS_DEV = process.env.NODE_ENV === "development"

export function normalizeForDisplay(response: ScoutResponse): NormalizedScoutResponse {
  const displayText = getScoutDisplayText(response.answer)

  return {
    displayText,
    recommendation:     response.recommendation,
    intent:             response.intent,
    confidence:         response.confidence,
    mode:               response.mode,
    actions:            response.actions ?? [],
    explanations:       response.explanations ?? [],
    workflow:           response.workflow,
    compare:            response.compare,
    interviewPrep:      response.interviewPrep,
    mockInterview:      response.mockInterview,
    graph:              response.graph,
    gated:              response.gated,
    workspace_directive: response.workspace_directive,
    workflow_directive:  response.workflow_directive,
    rawDebugPayload:    IS_DEV ? response : undefined,
  }
}

/** True when the normalized response has any structured content to render. */
export function hasStructuredContent(n: NormalizedScoutResponse): boolean {
  return (
    n.explanations.length > 0 ||
    Boolean(n.compare) ||
    Boolean(n.interviewPrep) ||
    Boolean(n.workflow) ||
    Boolean(n.graph) ||
    n.actions.length > 0
  )
}
