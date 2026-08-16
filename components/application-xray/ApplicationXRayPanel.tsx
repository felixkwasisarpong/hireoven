"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ApplicationXRay, RecommendedAction, XRayDimensionKey } from "@/lib/application-xray/types"
import { useToast } from "@/components/ui/ToastProvider"
import { cn } from "@/lib/utils"
import { getPrimaryAction } from "./xray-presenters"
import { XRayActionList } from "./XRayActionList"
import { XRayDataGaps } from "./XRayDataGaps"
import { XRayDecisionHero } from "./XRayDecisionHero"
import { XRayDimensionGrid } from "./XRayDimensionGrid"
import { XRayErrorState, type XRayLoadError } from "./XRayErrorState"
import { XRayEvidenceDrawer } from "./XRayEvidenceDrawer"
import { XRayRiskList } from "./XRayRiskList"
import { XRaySkeleton } from "./XRaySkeleton"

type ApplicationXRayApiPayload = {
  xray: ApplicationXRay
  meta: {
    requestedJobId: string
    evaluatedJobId: string | null
    resumeId: string | null
    computedAt: string
    schemaVersion: string
  }
}

type XRayUiEventName =
  | "panel_viewed"
  | "details_expanded"
  | "action_clicked"
  | "refresh_requested"
  | "resume_selection_used"

function trackXRayUiEvent(
  name: XRayUiEventName,
  xray: ApplicationXRay | null,
  extra: Record<string, string | boolean | null> = {},
) {
  if (typeof window === "undefined") return
  try {
    window.dispatchEvent(new CustomEvent("hireoven:xray", {
      detail: {
        event: name,
        surface: "job_detail",
        finalAction: xray?.finalAction ?? null,
        confidence: xray?.confidence ?? null,
        hasResume: Boolean(xray?.resumeId),
        schemaVersion: xray?.schemaVersion ?? null,
        ...extra,
      },
    }))
  } catch {
    // Telemetry should not affect the job-detail experience.
  }
}

async function parseXRayError(response: Response): Promise<XRayLoadError> {
  let code = ""
  try {
    const body = await response.json() as { error?: unknown }
    code = typeof body.error === "string" ? body.error : ""
  } catch {
    code = ""
  }
  return {
    status: response.status,
    message: code || `HTTP_${response.status}`,
  }
}

export function ApplicationXRayPanel({
  jobId,
  resumeId,
  applyUrl,
  className,
}: {
  jobId: string
  resumeId?: string | null
  applyUrl?: string | null
  className?: string
}) {
  const { pushToast } = useToast()
  const [payload, setPayload] = useState<ApplicationXRayApiPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<XRayLoadError | null>(null)
  const payloadRef = useRef<ApplicationXRayApiPayload | null>(null)
  const viewedHashRef = useRef<string | null>(null)

  const load = useCallback(async (options: { refresh: boolean; signal?: AbortSignal } = { refresh: false }) => {
    const params = new URLSearchParams()
    if (resumeId) params.set("resumeId", resumeId)
    const query = params.toString()
    const endpoint = `/api/jobs/${encodeURIComponent(jobId)}/xray${query ? `?${query}` : ""}`

    if (options.refresh) {
      setRefreshing(true)
      trackXRayUiEvent("refresh_requested", payloadRef.current?.xray ?? null)
    } else {
      setPayload(null)
      payloadRef.current = null
      setLoading(true)
    }
    setError(null)

    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        credentials: "include",
        signal: options.signal,
      })
      if (!response.ok) {
        throw await parseXRayError(response)
      }
      const nextPayload = await response.json() as ApplicationXRayApiPayload
      setPayload(nextPayload)
      payloadRef.current = nextPayload
      setError(null)
      if (resumeId) {
        trackXRayUiEvent("resume_selection_used", nextPayload.xray, { explicitResume: true })
      }
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return
      const nextError: XRayLoadError = typeof caught === "object" && caught !== null && "status" in caught
        ? caught as XRayLoadError
        : { status: null, message: "NETWORK_ERROR" }
      setError(nextError)
      if (options.refresh) {
        pushToast({
          tone: "error",
          title: "X-Ray refresh failed",
          description: "The previous analysis is still shown.",
        })
      }
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [jobId, pushToast, resumeId])

  useEffect(() => {
    const controller = new AbortController()
    void load({ refresh: false, signal: controller.signal })
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    const xray = payload?.xray
    if (!xray || viewedHashRef.current === xray.inputsHash) return
    viewedHashRef.current = xray.inputsHash
    trackXRayUiEvent("panel_viewed", xray)
  }, [payload])

  function handleRetry() {
    void load({ refresh: Boolean(payload) })
  }

  function handleActionClick(action: RecommendedAction) {
    trackXRayUiEvent("action_clicked", payload?.xray ?? null, { actionKind: action.kind })
  }

  function handleExpandDimension(dimension: XRayDimensionKey) {
    trackXRayUiEvent("details_expanded", payload?.xray ?? null, { detailType: dimension })
  }

  function handleEvidenceToggle(open: boolean) {
    if (open) trackXRayUiEvent("details_expanded", payload?.xray ?? null, { detailType: "evidence" })
  }

  if (loading && !payload) {
    return <XRaySkeleton />
  }

  if (!payload && error) {
    return <XRayErrorState error={error} onRetry={handleRetry} />
  }

  if (!payload) return null

  const xray = payload.xray
  // The hero renders exactly one "Next action"; everything downstream excludes
  // it so a single recommendation is not printed as both the next step and
  // ranked item #1. Likewise the dimension cards already surface their own data
  // gaps inline, so the panel-level list shows only gaps not attributable to a
  // dimension — previously "E-Verify participation is unknown" appeared in both.
  const primaryActionId = getPrimaryAction(xray)?.id ?? null
  const dimensionGapIds = new Set(
    (["hiringReality", "capability", "evidence", "eligibility", "positioning"] as const)
      .flatMap((key) => xray[key]?.dataGaps ?? [])
      .map((gap) => gap.id),
  )
  const unattributedGaps = xray.dataGaps.filter((gap) => !dimensionGapIds.has(gap.id))

  return (
    // XRayDecisionHero already prints an "Application X-Ray" eyebrow inside its
    // card, so a second one here rendered the label twice, consecutively, on
    // every job. The section keeps the accessible name.
    <section className={cn("space-y-4", className)} aria-label="Application X-Ray">
      {error ? <XRayErrorState error={error} onRetry={handleRetry} compact /> : null}

      <XRayDecisionHero
        xray={xray}
        applyUrl={applyUrl ?? null}
        jobId={jobId}
        refreshing={refreshing}
        onRefresh={handleRetry}
        onActionClick={handleActionClick}
      />

      <XRayDimensionGrid xray={xray} onExpandDimension={handleExpandDimension} />

      <XRayRiskList risks={xray.rejectionRisks} actions={xray.actions} />

      <XRayActionList
        actions={xray.actions}
        accessRoutes={xray.accessRoutes}
        applyUrl={applyUrl ?? null}
        jobId={jobId}
        onActionClick={handleActionClick}
        primaryActionId={primaryActionId}
      />

      <XRayDataGaps gaps={unattributedGaps} />

      <XRayEvidenceDrawer xray={xray} onToggle={handleEvidenceToggle} />
    </section>
  )
}
