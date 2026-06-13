import test from "node:test"
import assert from "node:assert/strict"
import {
  planSequenceSteps,
  nextDueStep,
  markStepSent,
  stopPendingSteps,
  deriveSequenceStatus,
  CADENCES,
} from "@/lib/apex/outreach/sequence"

const START = "2026-06-13T00:00:00.000Z"

test("plans one step per cadence template entry, initial due at start", () => {
  const steps = planSequenceSteps("referral_request", "linkedin", START)
  assert.equal(steps.length, CADENCES.referral_request.length)
  assert.equal(steps[0].kind, "initial")
  assert.equal(steps[0].scheduledFor.slice(0, 10), "2026-06-13")
  assert.equal(steps[0].status, "pending")
  // step 2 is 4 days out, step 3 a further 5 → 9 days from start
  assert.equal(steps[1].scheduledFor.slice(0, 10), "2026-06-17")
  assert.equal(steps[2].scheduledFor.slice(0, 10), "2026-06-22")
})

test("nextDueStep returns the initial step on day one and nothing once it's sent", () => {
  let steps = planSequenceSteps("recruiter_intro", "email", START)
  assert.equal(nextDueStep(steps, START)?.stepNumber, 1)
  steps = markStepSent(steps, "recruiter_intro", 1, START)
  // step 2 isn't due yet (3 days out)
  assert.equal(nextDueStep(steps, START), null)
})

test("marking a step sent re-anchors the next step to the real send date", () => {
  const steps = planSequenceSteps("recruiter_intro", "email", START)
  // user actually sends the initial a few days late
  const lateSend = "2026-06-20T00:00:00.000Z"
  const after = markStepSent(steps, "recruiter_intro", 1, lateSend)
  assert.equal(after[0].status, "sent")
  assert.equal(after[0].sentAt, lateSend)
  // step 2 gap is 3 days → re-anchored to 2026-06-23, not the original plan
  assert.equal(after[1].scheduledFor.slice(0, 10), "2026-06-23")
})

test("a reply stops every pending follow-up and sets status replied", () => {
  let steps = planSequenceSteps("referral_request", "linkedin", START)
  steps = markStepSent(steps, "referral_request", 1, START)
  steps = stopPendingSteps(steps)
  assert.deepEqual(
    steps.map((s) => s.status),
    ["sent", "skipped", "skipped"],
  )
  assert.equal(deriveSequenceStatus(steps, true), "replied")
})

test("status is completed once all steps are sent, active while pending remain", () => {
  let steps = planSequenceSteps("hiring_manager", "email", START)
  assert.equal(deriveSequenceStatus(steps, false), "active")
  steps = markStepSent(steps, "hiring_manager", 1, START)
  assert.equal(deriveSequenceStatus(steps, false), "active")
  steps = markStepSent(steps, "hiring_manager", 2, "2026-06-18T00:00:00.000Z")
  assert.equal(deriveSequenceStatus(steps, false), "completed")
})

test("a sequence stopped before any send reads as stopped, not completed", () => {
  let steps = planSequenceSteps("hiring_manager", "email", START)
  steps = stopPendingSteps(steps)
  assert.equal(deriveSequenceStatus(steps, false), "stopped")
})
