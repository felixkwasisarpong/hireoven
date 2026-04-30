"use client"

import { WorkflowStepRow } from "./WorkflowStepRow"
import type { ScoutActiveWorkflow } from "@/lib/scout/workflows/types"

type Props = {
  plan: ScoutActiveWorkflow
  onContinue: (stepId: string) => void
  onSkip: (stepId: string) => void
}

export function WorkflowTimeline({ plan, onContinue, onSkip }: Props) {
  return (
    <ol className="space-y-0">
      {plan.steps.map((step, i) => (
        <WorkflowStepRow
          key={step.id}
          step={step}
          isLast={i === plan.steps.length - 1}
          onContinue={() => onContinue(step.id)}
          onSkip={() => onSkip(step.id)}
        />
      ))}
    </ol>
  )
}
