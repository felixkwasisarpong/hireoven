/**
 * Scout Streaming Events — SSE wire protocol.
 *
 * Emitted by POST /api/scout/chat when body.stream === true.
 * Each event is a single line: data: <JSON>\n\n
 *
 * Protocol order:
 *   1..N  text_delta      — Claude is generating; stream text to the user
 *   1     workspace_directive  — if present, emitted early so workspace can morph
 *   1     response        — full processed ScoutResponse (same as non-stream endpoint)
 *   1     done            — stream is complete; client can tear down reader
 *
 * Error path:
 *   1     error           — stream failed; client preserves partial state
 */

import type {
  ScoutResponse,
  ScoutWorkspaceDirective,
  ScoutWorkflowDirective,
  ScoutAction,
  ScoutCompareResponse,
} from "@/lib/scout/types"
import type { ScoutGraph } from "@/components/scout/renderers/ScoutGraphRenderer"

export type ScoutStreamEvent =
  | { type: "text_delta";          text:    string }
  | { type: "workspace_directive"; payload: ScoutWorkspaceDirective }
  | { type: "workflow_directive";  payload: ScoutWorkflowDirective }
  | { type: "actions";             payload: ScoutAction[] }
  | { type: "compare";             payload: ScoutCompareResponse }
  | { type: "graph";               payload: ScoutGraph }
  | { type: "response";            payload: ScoutResponse }
  | { type: "done" }
  | { type: "error";               message: string }

/** Encode one SSE event line. */
export function encodeSSE(event: ScoutStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** Parse one SSE line received by the client. Returns null if not a data line. */
export function parseSSELine(line: string): ScoutStreamEvent | null {
  if (!line.startsWith("data: ")) return null
  try { return JSON.parse(line.slice(6)) as ScoutStreamEvent } catch { return null }
}
