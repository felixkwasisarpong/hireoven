/**
 * Apex Streaming Events — SSE wire protocol.
 *
 * Emitted by POST /api/apex/chat when body.stream === true.
 * Each event is a single line: data: <JSON>\n\n
 *
 * Protocol order:
 *   1..N  text_delta      — Claude is generating; stream text to the user
 *   1     workspace_directive  — if present, emitted early so workspace can morph
 *   1     response        — full processed ApexResponse (same as non-stream endpoint)
 *   1     done            — stream is complete; client can tear down reader
 *
 * Error path:
 *   1     error           — stream failed; client preserves partial state
 */

import type {
  ApexResponse,
  ApexWorkspaceDirective,
  ApexWorkflowDirective,
  ApexAction,
  ApexCompareResponse,
} from "@/lib/apex/types"
import type { ApexGraph } from "@/components/apex/renderers/ApexGraphRenderer"

export type ApexStreamEvent =
  | { type: "text_delta";          text:    string }
  | { type: "workspace_directive"; payload: ApexWorkspaceDirective }
  | { type: "workflow_directive";  payload: ApexWorkflowDirective }
  | { type: "actions";             payload: ApexAction[] }
  | { type: "compare";             payload: ApexCompareResponse }
  | { type: "graph";               payload: ApexGraph }
  | { type: "response";            payload: ApexResponse }
  | { type: "done" }
  | { type: "error";               message: string }

/** Encode one SSE event line. */
export function encodeSSE(event: ApexStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** Parse one SSE line received by the client. Returns null if not a data line. */
export function parseSSELine(line: string): ApexStreamEvent | null {
  if (!line.startsWith("data: ")) return null
  try { return JSON.parse(line.slice(6)) as ApexStreamEvent } catch { return null }
}
