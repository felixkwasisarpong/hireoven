"use client"

/**
 * ApexResponseRenderer — the single routing component for all Apex output.
 *
 * Used by:
 *   - ApexMessageBubble (dashboard + mini chat bubbles)
 *   - Any future Apex surface (extension overlay, mobile, etc.)
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
import { normalizeForDisplay, hasStructuredContent, type ApexRenderContext } from "@/lib/apex/normalize-apex-response"
import { renderInlineMarkdown } from "@/lib/apex/inline-markdown"
import { ApexActionRenderer } from "./ApexActionRenderer"
import { ApexCompareRenderer } from "./ApexCompareRenderer"
import { ApexExplanationRenderer } from "./ApexExplanationRenderer"
import { ApexInterviewPrepRenderer } from "./ApexInterviewPrepRenderer"
import { ApexWorkflowRenderer } from "./ApexWorkflowRenderer"
import { ApexGraphRenderer } from "./renderers/ApexGraphRenderer"
import type { ApexResponse } from "@/lib/apex/types"
import type { FeatureKey } from "@/lib/gates"
import { cn } from "@/lib/utils"

const IS_DEV = false

// ── Dev-only debug panel ──────────────────────────────────────────────────────

function DebugPanel({ raw }: { raw: ApexResponse }) {
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
  response:   ApexResponse
  context?:   ApexRenderContext
  /** Called when user clicks an upgrade CTA — pass through from parent */
  onUpgrade?: (feature: FeatureKey) => void
}

export function ApexResponseRenderer({ response, context = "dashboard", onUpgrade }: Props) {
  const n       = normalizeForDisplay(response)
  const compact = context === "mini" || context === "extension"

  const textSizeClass = compact ? "text-xs leading-5" : "text-sm leading-7"

  return (
    <div>
      {/* ── Display text — safe prose, never raw JSON ──────────────────── */}
      {n.displayText && (
        <p className={cn("whitespace-pre-wrap text-slate-800", textSizeClass)}>
          {renderInlineMarkdown(n.displayText)}
        </p>
      )}

      {/* ── Fallback when answer is blank but structured content exists ── */}
      {!n.displayText && hasStructuredContent(n) && (
        <p className={cn("text-slate-600", textSizeClass)}>
          Apex prepared the structured guidance below.
        </p>
      )}

      {/* ── Graph / chart ──────────────────────────────────────────────── */}
      {n.graph && (
        <ApexGraphRenderer graph={n.graph} compact={compact} />
      )}

      {/* ── Visual explanation blocks ──────────────────────────────────── */}
      <ApexExplanationRenderer explanations={n.explanations} compact={compact} />

      {/* ── Job comparison ─────────────────────────────────────────────── */}
      {n.compare && (
        <ApexCompareRenderer compare={n.compare} />
      )}

      {/* ── Interview prep ──────────────────────────────────────────────── */}
      {n.interviewPrep && (
        <ApexInterviewPrepRenderer interviewPrep={n.interviewPrep} />
      )}

      {/* ── Suggested actions ──────────────────────────────────────────── */}
      {n.actions.length > 0 && (
        <ApexActionRenderer actions={n.actions} source="chat" />
      )}

      {/* ── Guided workflow ─────────────────────────────────────────────── */}
      {n.workflow && (
        <ApexWorkflowRenderer workflow={n.workflow} />
      )}

      {/* ── Dev-only debug panel — raw JSON never shown by default ─────── */}
      {IS_DEV && n.rawDebugPayload && (
        <DebugPanel raw={n.rawDebugPayload} />
      )}
    </div>
  )
}
