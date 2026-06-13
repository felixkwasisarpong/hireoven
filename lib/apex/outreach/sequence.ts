/**
 * Active outreach engine — cadence + state machine.
 *
 * An outreach *sequence* is a multi-touch cadence aimed at one contact (a
 * recruiter, hiring manager, or potential referrer) at a target company:
 * an initial message, then timed follow-ups. The user sends each step manually
 * (Apex never auto-sends — see outreach/types.ts), marks it sent, and the engine
 * schedules the next touch. A reply stops the remaining follow-ups.
 *
 * This module is the pure, deterministic core: the cadence templates, the
 * scheduling math, and the state transitions. The API persists; the AI drafts.
 */

export type OutreachGoal = "referral_request" | "recruiter_intro" | "hiring_manager"
export type OutreachChannel = "linkedin" | "email"
export type StepKind = "initial" | "follow_up" | "final"
export type StepStatus = "pending" | "sent" | "skipped"
export type SequenceStatus = "active" | "replied" | "completed" | "stopped"

export type CadenceStep = {
  kind: StepKind
  /** Days after the *previous* step's send (0 for the initial touch). */
  gapDays: number
  /** One-line intent the drafter turns into a message. */
  purpose: string
}

export type PlannedStep = {
  stepNumber: number
  kind: StepKind
  channel: OutreachChannel
  status: StepStatus
  /** When this touch should go out (ISO date). */
  scheduledFor: string
  sentAt: string | null
  purpose: string
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Cadence templates per goal. Conservative spacing — outbound that doesn't nag. */
export const CADENCES: Record<OutreachGoal, CadenceStep[]> = {
  referral_request: [
    { kind: "initial", gapDays: 0, purpose: "Introduce yourself and make a low-effort referral ask" },
    { kind: "follow_up", gapDays: 4, purpose: "Gentle bump — restate the ask in one line, add a fresh detail" },
    { kind: "final", gapDays: 5, purpose: "Soft close — thank them, leave the door open, no pressure" },
  ],
  recruiter_intro: [
    { kind: "initial", gapDays: 0, purpose: "Concise intro tying your background to the role they're filling" },
    { kind: "follow_up", gapDays: 3, purpose: "Follow up with a specific proof point or relevant win" },
    { kind: "final", gapDays: 5, purpose: "Final check-in, offer to share more or move on" },
  ],
  hiring_manager: [
    { kind: "initial", gapDays: 0, purpose: "Direct, specific note on why you fit the team's current need" },
    { kind: "follow_up", gapDays: 5, purpose: "One follow-up adding a concrete result you'd bring" },
  ],
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString()
}

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

/**
 * Lay out the steps for a new sequence. The initial step is due at `startISO`;
 * each later step is tentatively scheduled by accumulating gapDays (it is
 * re-anchored to the real send date once the prior step is marked sent).
 */
export function planSequenceSteps(
  goal: OutreachGoal,
  channel: OutreachChannel,
  startISO: string,
): PlannedStep[] {
  let cursor = startISO
  return CADENCES[goal].map((c, i) => {
    cursor = i === 0 ? startISO : addDays(cursor, c.gapDays)
    return {
      stepNumber: i + 1,
      kind: c.kind,
      channel,
      status: "pending",
      scheduledFor: cursor,
      sentAt: null,
      purpose: c.purpose,
    }
  })
}

/** The earliest pending step whose scheduled date has arrived, if any. */
export function nextDueStep(steps: PlannedStep[], nowISO: string): PlannedStep | null {
  const now = dayKey(nowISO)
  return (
    steps
      .filter((s) => s.status === "pending" && dayKey(s.scheduledFor) <= now)
      .sort((a, b) => a.stepNumber - b.stepNumber)[0] ?? null
  )
}

/**
 * Mark a step sent and re-anchor the next pending step to `gapDays` after the
 * real send date, so the cadence tracks reality rather than the original plan.
 */
export function markStepSent(
  steps: PlannedStep[],
  goal: OutreachGoal,
  stepNumber: number,
  sentISO: string,
): PlannedStep[] {
  const template = CADENCES[goal]
  return steps.map((s) => {
    if (s.stepNumber === stepNumber) return { ...s, status: "sent", sentAt: sentISO }
    if (s.stepNumber === stepNumber + 1 && s.status === "pending") {
      const gap = template[stepNumber]?.gapDays ?? 4 // template is 0-indexed; next step's gap
      return { ...s, scheduledFor: addDays(sentISO, gap) }
    }
    return s
  })
}

/** A reply stops the cadence: every still-pending follow-up is skipped. */
export function stopPendingSteps(steps: PlannedStep[]): PlannedStep[] {
  return steps.map((s) => (s.status === "pending" ? { ...s, status: "skipped" } : s))
}

/** Derive the sequence status from its steps + whether the contact replied. */
export function deriveSequenceStatus(steps: PlannedStep[], replied: boolean): SequenceStatus {
  if (replied) return "replied"
  const pending = steps.filter((s) => s.status === "pending")
  const sent = steps.filter((s) => s.status === "sent")
  if (pending.length === 0) {
    // Nothing left to send. Completed if we actually sent something, else stopped.
    return sent.length > 0 ? "completed" : "stopped"
  }
  return "active"
}
