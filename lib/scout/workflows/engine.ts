"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ScoutActiveWorkflow, ScoutActiveWorkflowStep, ScoutWorkflowType } from "./types"
import { preparePlan } from "./definitions"
import { clearActiveWorkflow, readActiveWorkflow, writeActiveWorkflow } from "./store"

// ── State machine helpers ─────────────────────────────────────────────────────

function patchStep(
  workflow: ScoutActiveWorkflow,
  stepId: string,
  patch: Partial<ScoutActiveWorkflowStep>
): ScoutActiveWorkflow {
  return {
    ...workflow,
    steps: workflow.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)),
  }
}

function nextPendingStep(
  steps: ScoutActiveWorkflowStep[],
  afterId: string
): ScoutActiveWorkflowStep | null {
  const idx = steps.findIndex((s) => s.id === afterId)
  if (idx === -1) return null
  return steps.slice(idx + 1).find((s) => s.status === "pending") ?? null
}

function allSettled(steps: ScoutActiveWorkflowStep[]): boolean {
  return steps.every(
    (s) => s.status === "completed" || s.status === "skipped" || s.status === "failed"
  )
}

function advance(workflow: ScoutActiveWorkflow, completedId: string): ScoutActiveWorkflow {
  const next = nextPendingStep(workflow.steps, completedId)
  if (!next) {
    const settled = allSettled(workflow.steps)
    return settled ? { ...workflow, completedAt: new Date().toISOString(), activeStepId: undefined } : workflow
  }
  const nextStatus = next.requiresConfirmation ? "waiting_user" : "running"
  return {
    ...patchStep(workflow, next.id, { status: nextStatus }),
    activeStepId: next.id,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export type WorkflowEngineActions = {
  activeWorkflow: ScoutActiveWorkflow | null
  startWorkflow: (type: ScoutWorkflowType | string, payload?: Record<string, unknown>) => ScoutActiveWorkflow
  continueStep: (stepId: string) => void
  skipStep: (stepId: string) => void
  failStep: (stepId: string, reason?: string) => void
  pauseWorkflow: () => void
  resumeWorkflow: () => void
  cancelWorkflow: () => void
  isExpanded: boolean
  setExpanded: (v: boolean) => void
}

export function useWorkflowEngine(): WorkflowEngineActions {
  const [activeWorkflow, setActiveWorkflow] = useState<ScoutActiveWorkflow | null>(null)
  const [isExpanded, setExpanded] = useState(true)
  const hasMounted = useRef(false)

  // Restore session on mount (once)
  useEffect(() => {
    if (hasMounted.current) return
    hasMounted.current = true
    const saved = readActiveWorkflow()
    if (saved) {
      setActiveWorkflow(saved)
      setExpanded(true)
    }
  }, [])

  // Persist every change
  useEffect(() => {
    if (!hasMounted.current) return
    if (activeWorkflow) {
      writeActiveWorkflow(activeWorkflow)
    } else {
      clearActiveWorkflow()
    }
  }, [activeWorkflow])

  const startWorkflow = useCallback(
    (type: ScoutWorkflowType | string, payload?: Record<string, unknown>): ScoutActiveWorkflow => {
      const workflow = preparePlan(type, payload)
      setActiveWorkflow(workflow)
      setExpanded(true)
      return workflow
    },
    []
  )

  const continueStep = useCallback((stepId: string) => {
    setActiveWorkflow((prev) => {
      if (!prev) return prev
      const completed = patchStep(prev, stepId, { status: "completed" })
      return advance(completed, stepId)
    })
  }, [])

  const skipStep = useCallback((stepId: string) => {
    setActiveWorkflow((prev) => {
      if (!prev) return prev
      const skipped = patchStep(prev, stepId, { status: "skipped" })
      return advance(skipped, stepId)
    })
  }, [])

  const failStep = useCallback((stepId: string, reason?: string) => {
    setActiveWorkflow((prev) => {
      if (!prev) return prev
      const step = prev.steps.find((s) => s.id === stepId)
      return patchStep(prev, stepId, {
        status: "failed",
        ...(reason
          ? { payload: { ...(step?.payload ?? {}), failReason: reason } }
          : {}),
      })
    })
  }, [])

  const pauseWorkflow = useCallback(() => {
    setActiveWorkflow((prev) =>
      prev ? { ...prev, pausedAt: new Date().toISOString() } : prev
    )
  }, [])

  const resumeWorkflow = useCallback(() => {
    setActiveWorkflow((prev) =>
      prev ? { ...prev, pausedAt: undefined } : prev
    )
  }, [])

  const cancelWorkflow = useCallback(() => {
    setActiveWorkflow(null)
  }, [])

  return {
    activeWorkflow,
    startWorkflow,
    continueStep,
    skipStep,
    failStep,
    pauseWorkflow,
    resumeWorkflow,
    cancelWorkflow,
    isExpanded,
    setExpanded,
  }
}
