"use client"

/**
 * ScoutResponseRenderer — the single routing component for all Scout output.
 *
 * Used by:
 *   - ScoutMessageBubble (dashboard + mini chat bubbles)
 *   - Any future Scout surface (extension overlay, mobile, etc.)
 *
 * Contract:
 *   - NEVER renders raw JSON to the user
 *   - All structured payloads route to typed sub-renderers
 *   - workspace_directive and workflow_directive are stripped from display
 *   - Raw debug payload only visible in development, behind an explicit toggle
 *
 * context prop:
 *   "dashboard" — full rendering, all sections, standard text size
 *   "mini"      — compact text + actions only, no heavy blocks in primary view
 *   "extension" — same as mini (reserved for future extension UI)
 */

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { normalizeForDisplay, hasStructuredContent, type ScoutRenderContext } from "@/lib/scout/normalize-scout-response"
import { ScoutActionRenderer } from "./ScoutActionRenderer"
import { ScoutCompareRenderer } from "./ScoutCompareRenderer"
import { ScoutExplanationRenderer } from "./ScoutExplanationRenderer"
import { ScoutInterviewPrepRenderer } from "./ScoutInterviewPrepRenderer"
import { ScoutWorkflowRenderer } from "./ScoutWorkflowRenderer"
import { ScoutGraphRenderer } from "./renderers/ScoutGraphRenderer"
import type { ScoutResponse } from "@/lib/scout/types"
import type { FeatureKey } from "@/lib/gates"
import { cn } from "@/lib/utils"

const IS_DEV = process.env.NODE_ENV === "development"

// ── Dev-only debug panel ──────────────────────────────────────────────────────

function DebugPanel({ raw }: { raw: ScoutResponse }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400"
      >
        Debug payload
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <pre className="overflow-x-auto border-t border-slate-200 px-3 py-2 text-[10px] leading-4 text-slate-600">
          {JSON.stringify(raw, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── Public component ──────────────────────────────────────────────────────────

type Props = {
  response:   ScoutResponse
  context?:   ScoutRenderContext
  /** Called when user clicks an upgrade CTA — pass through from parent */
  onUpgrade?: (feature: FeatureKey) => void
}

export function ScoutResponseRenderer({ response, context = "dashboard", onUpgrade }: Props) {
  const n       = normalizeForDisplay(response)
  const compact = context === "mini" || context === "extension"

  const textSizeClass = compact ? "text-xs leading-5" : "text-sm leading-7"

  return (
    <div>
      {/* ── Display text — safe prose, never raw JSON ──────────────────── */}
      {n.displayText && (
        <p className={cn("whitespace-pre-wrap text-slate-800", textSizeClass)}>
          {n.displayText}
        </p>
      )}

      {/* ── Fallback when answer is blank but structured content exists ── */}
      {!n.displayText && hasStructuredContent(n) && (
        <p className={cn("text-slate-600", textSizeClass)}>
          Scout prepared the structured guidance below.
        </p>
      )}

      {/* ── Graph / chart ──────────────────────────────────────────────── */}
      {n.graph && (
        <ScoutGraphRenderer graph={n.graph} compact={compact} />
      )}

      {/* ── Visual explanation blocks ──────────────────────────────────── */}
      <ScoutExplanationRenderer explanations={n.explanations} compact={compact} />

      {/* ── Job comparison ─────────────────────────────────────────────── */}
      {n.compare && (
        <ScoutCompareRenderer compare={n.compare} />
      )}

      {/* ── Interview prep ──────────────────────────────────────────────── */}
      {n.interviewPrep && (
        <ScoutInterviewPrepRenderer interviewPrep={n.interviewPrep} />
      )}

      {/* ── Suggested actions ──────────────────────────────────────────── */}
      {n.actions.length > 0 && (
        <ScoutActionRenderer actions={n.actions} source="chat" />
      )}

      {/* ── Guided workflow ─────────────────────────────────────────────── */}
      {n.workflow && (
        <ScoutWorkflowRenderer workflow={n.workflow} />
      )}

      {/* ── Dev-only debug panel — raw JSON never shown by default ─────── */}
      {IS_DEV && n.rawDebugPayload && (
        <DebugPanel raw={n.rawDebugPayload} />
      )}
    </div>
  )
}
