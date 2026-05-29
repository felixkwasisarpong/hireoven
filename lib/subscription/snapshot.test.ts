import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  buildSubscriptionSnapshot,
  evaluateSubscriptionSnapshotConsistency,
  normalizeSubscriptionPlan,
} from "./snapshot"

test("normalizeSubscriptionPlan maps pro_international to pro_max", () => {
  assert.equal(normalizeSubscriptionPlan("pro_international"), "pro_max")
  assert.equal(normalizeSubscriptionPlan("pro"), "pro")
  assert.equal(normalizeSubscriptionPlan("unexpected"), "free")
})

test("buildSubscriptionSnapshot computes trialDaysRemaining for trialing status", () => {
  const now = Date.parse("2026-05-25T00:00:00.000Z")
  const snapshot = buildSubscriptionSnapshot(
    {
      plan: "pro",
      status: "trialing",
      current_period_end: "2026-05-29T00:00:00.000Z",
      billing_interval: "monthly",
      amount_cents: 1900,
      cancel_at_period_end: false,
      trial_end: "2026-05-29T00:00:00.000Z",
    },
    now
  )

  assert.equal(snapshot.trialDaysRemaining, 4)
})

test("evaluateSubscriptionSnapshotConsistency passes a valid paid snapshot", () => {
  const snapshot = buildSubscriptionSnapshot({
    plan: "pro_max",
    status: "active",
    current_period_end: "2026-06-25T00:00:00.000Z",
    billing_interval: "monthly",
    amount_cents: 2900,
    cancel_at_period_end: false,
    trial_end: null,
  })

  const result = evaluateSubscriptionSnapshotConsistency(snapshot)
  assert.equal(result.ok, true)
  assert.equal(result.issues.length, 0)
})

test("evaluateSubscriptionSnapshotConsistency flags amount and interval mismatches", () => {
  const snapshot = buildSubscriptionSnapshot({
    plan: "pro",
    status: "active",
    current_period_end: "2026-06-25T00:00:00.000Z",
    billing_interval: null,
    amount_cents: 500,
    cancel_at_period_end: false,
    trial_end: null,
  })

  const result = evaluateSubscriptionSnapshotConsistency(snapshot)
  assert.equal(result.ok, false)
  assert.equal(result.issues.some((issue) => issue.code === "missing_billing_interval"), true)
})

test("evaluateSubscriptionSnapshotConsistency flags free-plan contradictions", () => {
  const snapshot = buildSubscriptionSnapshot({
    plan: "free",
    status: "active",
    current_period_end: null,
    billing_interval: "monthly",
    amount_cents: 1900,
    cancel_at_period_end: true,
    trial_end: null,
  })

  const result = evaluateSubscriptionSnapshotConsistency(snapshot)
  assert.equal(result.ok, false)
  assert.equal(result.issues.some((issue) => issue.code === "free_plan_with_paid_status"), true)
  assert.equal(result.issues.some((issue) => issue.code === "free_plan_with_positive_amount"), true)
  assert.equal(result.issues.some((issue) => issue.code === "free_plan_with_interval"), true)
})

test("evaluateSubscriptionSnapshotConsistency flags free status with cancel flag", () => {
  const snapshot = buildSubscriptionSnapshot({
    plan: "free",
    status: "free",
    current_period_end: null,
    billing_interval: null,
    amount_cents: null,
    cancel_at_period_end: true,
    trial_end: null,
  })

  const result = evaluateSubscriptionSnapshotConsistency(snapshot)
  assert.equal(result.ok, false)
  assert.equal(result.issues.some((issue) => issue.code === "free_status_with_cancel_flag"), true)
})

test("buildSubscriptionSnapshot demotes canceled+expired to fully free", () => {
  const now = Date.parse("2026-05-29T00:00:00.000Z")
  const snapshot = buildSubscriptionSnapshot(
    {
      plan: "pro_international",
      status: "canceled",
      current_period_end: "2026-05-27T15:54:22.158Z",
      billing_interval: "monthly",
      amount_cents: 2900,
      cancel_at_period_end: true,
      trial_end: null,
    },
    now
  )

  assert.equal(snapshot.plan, "free")
  assert.equal(snapshot.status, "free")
  assert.equal(snapshot.currentPeriodEnd, null)
  assert.equal(snapshot.amountCents, null)
  assert.equal(snapshot.billingInterval, null)
  assert.equal(snapshot.cancelAtPeriodEnd, false)
})

test("buildSubscriptionSnapshot preserves canceled subscription with future period_end", () => {
  // User canceled but still has paid time remaining.
  const now = Date.parse("2026-05-29T00:00:00.000Z")
  const snapshot = buildSubscriptionSnapshot(
    {
      plan: "pro",
      status: "canceled",
      current_period_end: "2026-06-15T00:00:00.000Z",
      billing_interval: "monthly",
      amount_cents: 1900,
      cancel_at_period_end: true,
      trial_end: null,
    },
    now
  )

  // Still has Pro until June 15 — don't demote yet.
  assert.equal(snapshot.plan, "pro")
  assert.equal(snapshot.status, "canceled")
  assert.equal(snapshot.currentPeriodEnd, "2026-06-15T00:00:00.000Z")
})
