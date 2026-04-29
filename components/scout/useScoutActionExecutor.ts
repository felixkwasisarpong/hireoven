"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useRouter } from "next/navigation"
import type { ScoutAction } from "@/lib/scout/types"

export type ScoutActionSource = "chat" | "nudge" | "strategy" | "workflow"

/** Compact audit record stored alongside an action's confirmation and timeline entry. */
export type ScoutAuditEntry = {
  actionType: string
  label: string
  timestamp: number
  source?: ScoutActionSource
  reason?: string
  previousStateSummary?: string
  newStateSummary?: string
}

type ExecutorOptions = {
  onExecuted?: () => void
  /** Where this action originated (chat, nudge, strategy, workflow). */
  source?: ScoutActionSource
  /** Human-readable reason Scout suggested this action. */
  reason?: string
}

export type ScoutActionConfirmation = {
  title: string
  details: string[]
  canUndo: boolean
  /** Live job count injected after the feed refreshes */
  jobCount?: number
  /** Audit trail for the "Why this?" button */
  auditEntry?: ScoutAuditEntry
}

export type ScoutLastChange = {
  actionType: string
  label: string
  previousSearchParams: string
  newSearchParams: string
  timestamp: number
  source?: ScoutActionSource
  reason?: string
  previousStateSummary?: string
  newStateSummary?: string
}

/** Payload broadcast on window when a Scout action is recorded in the session. */
export type ScoutActionRecordedDetail = {
  id: string
  actionType: string
  label: string
  timestamp: number
  /** URL to navigate to in order to undo — only set for URL-based actions */
  undoUrl?: string
  source?: ScoutActionSource
  reason?: string
  previousStateSummary?: string
  newStateSummary?: string
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function summarizeSearchParams(p: URLSearchParams): string {
  const parts: string[] = []
  if (p.get("q")) parts.push(`"${p.get("q")}"`)
  if (p.get("location")) parts.push(p.get("location")!)
  if (p.get("workMode")) parts.push(p.get("workMode")!)
  if (p.get("sponsorship")) parts.push(`${p.get("sponsorship")} sponsorship`)
  if (p.get("focus") === "1") parts.push("Focus Mode")
  return parts.length > 0 ? parts.join(" · ") : "No active filters"
}

function buildStateSummaries(
  action: ScoutAction,
  currentSearchParams: URLSearchParams
): { previousStateSummary: string; newStateSummary: string } {
  switch (action.type) {
    case "APPLY_FILTERS": {
      const newParams = new URLSearchParams()
      if (action.payload.query) newParams.set("q", action.payload.query)
      if (action.payload.location) newParams.set("location", action.payload.location)
      if (action.payload.workMode) newParams.set("workMode", action.payload.workMode)
      if (action.payload.sponsorship) newParams.set("sponsorship", action.payload.sponsorship)
      return {
        previousStateSummary: summarizeSearchParams(currentSearchParams),
        newStateSummary: summarizeSearchParams(newParams),
      }
    }
    case "SET_FOCUS_MODE":
      return {
        previousStateSummary: action.payload.enabled ? "Focus Mode off" : "Focus Mode on",
        newStateSummary: action.payload.enabled
          ? "Focus Mode on — feed sorted by best match"
          : "Focus Mode off — default feed order",
      }
    case "HIGHLIGHT_JOBS": {
      const count = action.payload.jobIds.length
      return {
        previousStateSummary: "Default feed view",
        newStateSummary: `${count} job${count !== 1 ? "s" : ""} highlighted in feed`,
      }
    }
    case "OPEN_JOB":
      return { previousStateSummary: "Feed or current page", newStateSummary: "Viewing job detail" }
    case "OPEN_COMPANY":
      return { previousStateSummary: "Current page", newStateSummary: "Viewing company profile" }
    case "OPEN_RESUME_TAILOR":
      return { previousStateSummary: "Current page", newStateSummary: "Resume tailor opened" }
    case "RESET_CONTEXT":
      return {
        previousStateSummary: "Active filters and Scout context",
        newStateSummary: "Scout context and filters cleared",
      }
    default:
      return { previousStateSummary: "Previous state", newStateSummary: "Updated state" }
  }
}

export function useScoutActionExecutor() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [highlightedJobs, setHighlightedJobs] = useState<string[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<ScoutActionConfirmation | null>(null)
  const [lastChange, setLastChange] = useState<ScoutLastChange | null>(null)

  // Ref mirror of confirmation — lets the feed-updated listener read current state
  // without needing to be re-registered on every confirmation change
  const confirmationRef = useRef<ScoutActionConfirmation | null>(null)
  confirmationRef.current = confirmation

  // Stores the actual undo callback without triggering re-renders on assignment
  const undoFnRef = useRef<(() => void) | null>(null)
  // Tracks what kind of action was undone so the post-undo banner is contextual
  const undoTypeRef = useRef<"filters" | "highlights" | null>(null)
  const confirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Listen for the feed to report its updated job count and patch it into
  // the live confirmation so the banner shows "Showing X jobs" without an AI call
  useEffect(() => {
    function onFeedUpdated(e: Event) {
      const detail = (e as CustomEvent<{ totalCount: number }>).detail
      if (!confirmationRef.current || typeof detail?.totalCount !== "number") return
      setConfirmation((prev) =>
        prev ? { ...prev, jobCount: detail.totalCount } : prev
      )
    }
    window.addEventListener("scout:feed-updated", onFeedUpdated)
    return () => window.removeEventListener("scout:feed-updated", onFeedUpdated)
  }, [])

  function showFeedback(message: string) {
    setFeedback(message)
    setTimeout(() => setFeedback(null), 3000)
  }

  function showConfirmation(
    state: ScoutActionConfirmation,
    undoFn?: () => void,
    duration = 8000
  ) {
    if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current)
    undoFnRef.current = undoFn ?? null
    setConfirmation(state)
    confirmationTimerRef.current = setTimeout(() => {
      setConfirmation(null)
      undoFnRef.current = null
    }, duration)
  }

  function dismissConfirmation() {
    if (confirmationTimerRef.current) clearTimeout(confirmationTimerRef.current)
    setConfirmation(null)
    undoFnRef.current = null
  }

  function executeUndo() {
    const undoType = undoTypeRef.current
    const undoFn = undoFnRef.current
    undoFnRef.current = null
    undoTypeRef.current = null

    undoFn?.()

    if (undoType === "filters") {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("scout:filters-restored"))
      }
      showConfirmation(
        {
          title: "Feed restored",
          details: ["Previous filters applied", "Results refreshed"],
          canUndo: false,
        },
        undefined,
        4000
      )
    } else if (undoType === "highlights") {
      showConfirmation(
        {
          title: "Highlights cleared",
          details: ["Feed returned to normal view"],
          canUndo: false,
        },
        undefined,
        3000
      )
    } else {
      setConfirmation(null)
    }
  }

  function executeAction(action: ScoutAction, options?: ExecutorOptions) {
    try {
      const { source, reason } = options ?? {}

      switch (action.type) {
        case "OPEN_JOB":
          router.push(`/dashboard/jobs/${action.payload.jobId}`)
          showFeedback("Opening job…")
          break

        case "APPLY_FILTERS": {
          const previousSearchParams = searchParams.toString()
          const previousUrl = `${pathname}${previousSearchParams ? `?${previousSearchParams}` : ""}`

          const params = new URLSearchParams()
          if (action.payload.query) params.set("q", action.payload.query)
          if (action.payload.location) params.set("location", action.payload.location)
          if (action.payload.workMode) params.set("workMode", action.payload.workMode)
          if (action.payload.sponsorship) params.set("sponsorship", action.payload.sponsorship)

          const queryString = params.toString()
          router.push(`/dashboard${queryString ? `?${queryString}` : ""}`)

          // Build human-readable applied-filter list
          const applied: string[] = []
          if (action.payload.query) applied.push(`"${action.payload.query}"`)
          if (action.payload.location) applied.push(action.payload.location)
          if (action.payload.workMode) applied.push(action.payload.workMode)
          if (action.payload.sponsorship) applied.push(`${action.payload.sponsorship} sponsorship`)

          // Build "what was prioritized" description
          const prioritized: string[] = []
          if (action.payload.query) prioritized.push("keyword match")
          if (action.payload.sponsorship === "high") prioritized.push("high sponsorship")
          if (action.payload.location) prioritized.push("location")
          if (action.payload.workMode) prioritized.push(action.payload.workMode)

          // Notify the feed toolbar which filter buttons to highlight
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("scout:filters-applied", {
                detail: { paramKeys: [...params.keys()] },
              })
            )
          }

          const label = action.label ?? (applied.length > 0 ? applied.join(" · ") : "Filters")
          const { previousStateSummary, newStateSummary } = buildStateSummaries(
            action,
            new URLSearchParams(searchParams.toString())
          )
          const ts = Date.now()
          const auditEntry: ScoutAuditEntry = {
            actionType: "APPLY_FILTERS",
            label: applied.length > 0 ? `Applied: ${applied.join(" · ")}` : "Filters applied",
            timestamp: ts,
            source,
            reason,
            previousStateSummary,
            newStateSummary,
          }

          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("scout:action-recorded", {
                detail: {
                  id: `action-${ts}`,
                  ...auditEntry,
                  undoUrl: previousUrl,
                } satisfies ScoutActionRecordedDetail,
              })
            )
          }

          setLastChange({
            actionType: "APPLY_FILTERS",
            label,
            previousSearchParams,
            newSearchParams: queryString,
            timestamp: ts,
            source,
            reason,
            previousStateSummary,
            newStateSummary,
          })

          undoTypeRef.current = "filters"
          showConfirmation(
            {
              title: "Scout updated your feed",
              details: [
                applied.length > 0 ? `Applied: ${applied.join(" · ")}` : "Filters applied",
                prioritized.length > 0 ? `Prioritized: ${prioritized.join(" · ")}` : "Results refreshed",
              ],
              canUndo: true,
              auditEntry,
            },
            () => router.push(previousUrl)
          )
          break
        }

        case "OPEN_RESUME_TAILOR":
          if (action.payload.jobId) {
            router.push(`/dashboard/resumes/tailor?jobId=${action.payload.jobId}`)
          } else if (action.payload.resumeId) {
            router.push(`/dashboard/resumes/${action.payload.resumeId}/edit`)
          }
          showFeedback("Opening resume tailor…")
          break

        case "HIGHLIGHT_JOBS": {
          const count = action.payload.jobIds.length
          setHighlightedJobs(action.payload.jobIds)

          const { previousStateSummary: prevSum, newStateSummary: newSum } = buildStateSummaries(
            action,
            new URLSearchParams(searchParams.toString())
          )
          const ts = Date.now()
          const auditEntry: ScoutAuditEntry = {
            actionType: "HIGHLIGHT_JOBS",
            label: `Highlighted ${count} job${count !== 1 ? "s" : ""}`,
            timestamp: ts,
            source,
            reason: reason ?? action.payload.reason,
            previousStateSummary: prevSum,
            newStateSummary: newSum,
          }

          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("scout:action-recorded", {
                detail: {
                  id: `action-${ts}`,
                  ...auditEntry,
                } satisfies ScoutActionRecordedDetail,
              })
            )
          }

          undoTypeRef.current = "highlights"
          showConfirmation(
            {
              title: `Scout highlighted ${count} job${count !== 1 ? "s" : ""}`,
              details: [
                action.payload.reason ?? `${count} job${count !== 1 ? "s" : ""} marked`,
                "Scroll your feed to see them",
                "Visual only — not saved across sessions",
              ],
              canUndo: true,
              auditEntry,
            },
            () => {
              setHighlightedJobs([])
            }
          )
          break
        }

        case "OPEN_COMPANY":
          router.push(`/dashboard/companies/${action.payload.companyId}`)
          showFeedback("Opening company profile…")
          break

        case "RESET_CONTEXT": {
          // Dispatch reset event so all Scout chat components clear their state
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("scout:reset-context"))
          }
          if (action.payload.clearFilters !== false) {
            router.push("/dashboard")
          }
          showFeedback("Scout context reset")
          break
        }

        case "OPEN_EXTENSION_BRIDGE": {
          // Phase 1.4 placeholder — show a prompt to install/open the extension.
          // No navigation, no auto-apply; purely informational.
          showFeedback(
            action.payload.hint ??
              "Open the Hireoven Scout extension on a job page to capture it."
          )
          break
        }

        case "OPEN_EXTENSION_AUTOFILL_PREVIEW": {
          // Phase 2 — instructs the user to open the extension autofill preview.
          // Scout cannot directly trigger the extension; this is purely a UI hint.
          const hint = action.payload.hint
          const url = action.payload.url
          const message = hint
            ? hint
            : url
            ? `Navigate to the application form, then click the Hireoven extension icon and choose "Preview Autofill": ${url}`
            : "Open the Hireoven Scout extension on the application form page and click \"Preview Autofill\" to fill your details."
          showFeedback(message)
          break
        }

        case "PREPARE_TAILORED_AUTOFILL": {
          // Phase 3 — guide user through tailor-before-autofill flow.
          // Scout cannot control the extension directly; we show a step-by-step instruction.
          const { jobId, url, hint } = action.payload

          if (hint) {
            showFeedback(hint)
            break
          }

          // If a jobId is provided, navigate to the job page so the user can open the
          // extension there to save + tailor before going to the application form.
          if (jobId) {
            router.push(`/dashboard/jobs/${jobId}`)
          }

          showConfirmation(
            {
              title: "Tailor Resume & Autofill — 4 steps",
              details: [
                jobId
                  ? "1. Navigate to the employer's application form"
                  : url
                  ? `1. Open the application form: ${url}`
                  : "1. Open the application form in your browser",
                "2. Click the Hireoven icon → \"Tailor Resume\"",
                "3. Review suggested changes and click \"Use this tailored resume\"",
                "4. Click \"Preview Autofill\" → \"Autofill this application\"",
              ],
              canUndo: false,
            },
            undefined,
            12000
          )
          break
        }

        case "SET_FOCUS_MODE": {
          const previousSearchParams = searchParams.toString()
          const previousUrl = `${pathname}${previousSearchParams ? `?${previousSearchParams}` : ""}`

          if (action.payload.enabled) {
            const params = new URLSearchParams(searchParams.toString())
            params.set("focus", "1")
            params.set("sort", "match")
            router.push(`/dashboard?${params.toString()}`)

            const { previousStateSummary, newStateSummary } = buildStateSummaries(
              action,
              new URLSearchParams(searchParams.toString())
            )
            const ts = Date.now()
            const auditEntry: ScoutAuditEntry = {
              actionType: "SET_FOCUS_MODE",
              label: action.payload.reason ?? "Focus Mode on",
              timestamp: ts,
              source,
              reason,
              previousStateSummary,
              newStateSummary,
            }

            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("scout:filters-applied", {
                  detail: { paramKeys: ["focus", "sort"] },
                })
              )
              window.dispatchEvent(
                new CustomEvent("scout:action-recorded", {
                  detail: {
                    id: `action-${ts}`,
                    ...auditEntry,
                    undoUrl: previousUrl,
                  } satisfies ScoutActionRecordedDetail,
                })
              )
            }

            setLastChange({
              actionType: "SET_FOCUS_MODE",
              label: "Focus Mode",
              previousSearchParams,
              newSearchParams: params.toString(),
              timestamp: ts,
              source,
              reason,
              previousStateSummary,
              newStateSummary,
            })

            undoTypeRef.current = "filters"
            showConfirmation(
              {
                title: "Scout Focus Mode is on",
                details: [
                  action.payload.reason ?? "Sorted by best match",
                  "Prioritized: match score · recency · sponsorship",
                  "No jobs deleted — turn off anytime",
                ],
                canUndo: true,
                auditEntry,
              },
              () => router.push(previousUrl)
            )
          } else {
            const params = new URLSearchParams(searchParams.toString())
            params.delete("focus")
            params.delete("sort")
            const qs = params.toString()
            router.push(`/dashboard${qs ? `?${qs}` : ""}`)
            showFeedback("Focus Mode off")
          }
          break
        }
      }

      options?.onExecuted?.()
    } catch (err) {
      console.error("Error executing Scout action:", err)
      showFeedback("Failed to execute action")
    }
  }

  return {
    executeAction,
    feedback,
    highlightedJobs,
    confirmation,
    lastChange,
    dismissConfirmation,
    executeUndo,
  }
}
