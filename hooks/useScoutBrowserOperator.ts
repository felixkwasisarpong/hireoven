"use client"

/**
 * Scout Browser Operator Hook — V1
 *
 * Manages the browser action queue: permission checking, approval gates,
 * dispatch, and timeline recording. All actions are visible and cancellable.
 *
 * State machine per action:
 *   queued → if requiresApproval: "pending" → (user approves) → "running" → "completed" / "failed"
 *   queued → if no approval needed:             "running" → "completed" / "failed"
 *   queued → if permission denied / no ext:     "blocked"
 */

import { useCallback, useRef, useState } from "react"
import { checkPermission } from "@/lib/scout/permissions"
import { dispatchBrowserAction, buildActionSummary, buildApprovalPrompt } from "@/lib/scout/browser-operator/executor"
import {
  BROWSER_ACTION_PERMISSION,
  APPROVAL_REQUIRED_ACTIONS,
} from "@/lib/scout/browser-operator/types"
import type {
  ScoutBrowserAction,
  ScoutBrowserActionEvent,
} from "@/lib/scout/browser-operator/types"
import type { ScoutPermissionState } from "@/lib/scout/permissions"
import type { ActiveBrowserContext } from "@/lib/scout/browser-context"

// ── Options ───────────────────────────────────────────────────────────────────

export type UseOperatorOptions = {
  permissions:         ScoutPermissionState[]
  browserContext:      ActiveBrowserContext | null
  isExtensionConnected: boolean
  onTimelineEvent?:    (event: { type: "browser_action"; title: string; summary?: string; severity?: "info" | "warning" | "error" }) => void
}

export type ExecuteOptions = {
  target?:   string
  payload?:  Record<string, unknown>
  context?:  ScoutBrowserActionEvent["context"]
}

export type UseOperatorResult = {
  /** All actions in this session (newest-first) */
  events:            ScoutBrowserActionEvent[]
  /** Current running or pending-approval action */
  activeAction:      ScoutBrowserActionEvent | null
  /** Actions awaiting user approval */
  pendingApprovals:  ScoutBrowserActionEvent[]
  /** Queue one browser action */
  execute:           (action: ScoutBrowserAction, opts?: ExecuteOptions) => void
  /** Approve a pending action (triggers dispatch) */
  approve:           (actionId: string) => void
  /** Cancel a pending or running action */
  cancel:            (actionId: string) => void
  /** Clear all completed/failed events */
  clearHistory:      () => void
}

const MAX_EVENTS = 30
const COMPLETION_DELAY_MS = 3_000   // optimistic completion after dispatch

function makeId(): string {
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function useScoutBrowserOperator({
  permissions,
  browserContext,
  isExtensionConnected,
  onTimelineEvent,
}: UseOperatorOptions): UseOperatorResult {
  const [events, setEvents] = useState<ScoutBrowserActionEvent[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // ── Internal helpers ────────────────────────────────────────────────────────

  const patchEvent = useCallback((id: string, patch: Partial<ScoutBrowserActionEvent>) => {
    setEvents((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e))
  }, [])

  const scheduleCompletion = useCallback((id: string) => {
    const t = setTimeout(() => {
      patchEvent(id, { status: "completed" })
      timersRef.current.delete(id)
    }, COMPLETION_DELAY_MS)
    timersRef.current.set(id, t)
  }, [patchEvent])

  // ── Dispatch an action (shared by execute and approve) ─────────────────────

  const dispatch = useCallback((event: ScoutBrowserActionEvent) => {
    const result = dispatchBrowserAction(event.action, event.context ? {
      ...event.context,
      target: event.target,
    } : { target: event.target })

    if (result.dispatched) {
      const summary = buildActionSummary(event.action, event.target, event.context)
      patchEvent(event.id, { status: "running", summary })

      onTimelineEvent?.({
        type:    "browser_action",
        title:   summary,
        severity: "info",
      })

      scheduleCompletion(event.id)
    } else {
      const reason = result.reason ?? "Extension bridge unavailable"
      patchEvent(event.id, {
        status:  "failed",
        summary: `Could not complete — ${reason}`,
      })

      onTimelineEvent?.({
        type:     "browser_action",
        title:    `Browser action failed: ${event.action}`,
        summary:  reason,
        severity: "error",
      })
    }
  }, [patchEvent, scheduleCompletion, onTimelineEvent])

  // ── Public API ─────────────────────────────────────────────────────────────

  const execute = useCallback((action: ScoutBrowserAction, opts: ExecuteOptions = {}) => {
    const { target, payload, context } = opts

    // Permission check using existing system
    const permKey = BROWSER_ACTION_PERMISSION[action]
    if (permKey) {
      const check = checkPermission(permKey, permissions)
      if (!check.allowed) {
        const blocked: ScoutBrowserActionEvent = {
          id:        makeId(),
          action,
          status:    "blocked",
          target,
          summary:   check.reason ?? "Permission denied",
          timestamp: new Date().toISOString(),
          context,
        }
        setEvents((prev) => [blocked, ...prev].slice(0, MAX_EVENTS))
        onTimelineEvent?.({ type: "browser_action", title: `Browser action blocked: ${action}`, summary: check.reason, severity: "warning" })
        return
      }
    }

    // Extension connectivity check (warn but don't block for non-critical actions)
    if (!isExtensionConnected && (action === "upload_resume" || action === "insert_text" || action === "prepare_autofill")) {
      const blocked: ScoutBrowserActionEvent = {
        id:        makeId(),
        action,
        status:    "blocked",
        target,
        summary:   "Extension not connected — open the Hireoven extension on a job or application page first.",
        timestamp: new Date().toISOString(),
        context:   context ?? { atsProvider: browserContext?.atsProvider },
      }
      setEvents((prev) => [blocked, ...prev].slice(0, MAX_EVENTS))
      return
    }

    const requiresApproval = APPROVAL_REQUIRED_ACTIONS.has(action)

    const event: ScoutBrowserActionEvent = {
      id:              makeId(),
      action,
      status:          requiresApproval ? "pending" : "running",
      target,
      summary:         requiresApproval
                         ? buildApprovalPrompt(action, target)
                         : buildActionSummary(action, target, context ?? { atsProvider: browserContext?.atsProvider }),
      requiresApproval,
      timestamp:       new Date().toISOString(),
      context:         context ?? (browserContext ? {
                         jobTitle:    browserContext.title,
                         company:     browserContext.company,
                         atsProvider: browserContext.atsProvider,
                       } : undefined),
    }

    setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS))

    if (!requiresApproval) {
      dispatch(event)
      onTimelineEvent?.({ type: "browser_action", title: event.summary ?? `Browser action: ${action}`, severity: "info" })
    }
  }, [permissions, isExtensionConnected, browserContext, dispatch, onTimelineEvent])

  const approve = useCallback((actionId: string) => {
    const ev = events.find((e) => e.id === actionId && e.status === "pending")
    if (!ev) return
    dispatch(ev)
  }, [events, dispatch])

  const cancel = useCallback((actionId: string) => {
    const timer = timersRef.current.get(actionId)
    if (timer) { clearTimeout(timer); timersRef.current.delete(actionId) }
    patchEvent(actionId, { status: "failed", summary: "Cancelled by user" })
    onTimelineEvent?.({ type: "browser_action", title: "Browser action cancelled", severity: "info" })
  }, [patchEvent, onTimelineEvent])

  const clearHistory = useCallback(() => {
    setEvents((prev) => prev.filter((e) => e.status === "pending" || e.status === "running"))
  }, [])

  const activeAction = events.find((e) => e.status === "running" || e.status === "pending") ?? null
  const pendingApprovals = events.filter((e) => e.status === "pending" && e.requiresApproval)

  return { events, activeAction, pendingApprovals, execute, approve, cancel, clearHistory }
}
