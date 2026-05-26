import type { Plan } from "@/lib/gates"
import { getPlanAmountCents, type BillingInterval } from "@/lib/pricing"

const DAY_MS = 86_400_000

export type SubscriptionStatus =
  | "free"
  | "active"
  | "trialing"
  | "past_due"
  | "unpaid"
  | "canceled"

export interface SubscriptionRowSnapshot {
  plan: string | null
  status: string | null
  current_period_end: string | null
  billing_interval: string | null
  amount_cents: number | null
  cancel_at_period_end: boolean | null
  trial_end: string | null
}

export interface SubscriptionSnapshot {
  plan: Plan
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  billingInterval: BillingInterval | null
  amountCents: number | null
  cancelAtPeriodEnd: boolean
  trialEnd: string | null
  trialDaysRemaining: number | null
}

export interface SubscriptionConsistencyIssue {
  code: string
  message: string
}

export interface SubscriptionConsistencyResult {
  ok: boolean
  issues: SubscriptionConsistencyIssue[]
}

const PAID_PLAN_SET = new Set<Plan>(["pro", "pro_max"])
const ACTIVE_STATUS_SET = new Set<SubscriptionStatus>(["active", "trialing", "past_due", "unpaid"])

export function normalizeSubscriptionPlan(rawPlan: string | null | undefined): Plan {
  if (rawPlan === "pro_international") return "pro_max"
  if (rawPlan === "pro" || rawPlan === "pro_max") return rawPlan
  return "free"
}

export function normalizeSubscriptionStatus(rawStatus: string | null | undefined): SubscriptionStatus {
  if (
    rawStatus === "active" ||
    rawStatus === "trialing" ||
    rawStatus === "past_due" ||
    rawStatus === "unpaid" ||
    rawStatus === "canceled"
  ) {
    return rawStatus
  }
  return "free"
}

function normalizeBillingInterval(raw: string | null | undefined): BillingInterval | null {
  if (raw === "monthly" || raw === "yearly") return raw
  return null
}

function computeTrialDaysRemaining(
  status: SubscriptionStatus,
  trialEnd: string | null,
  currentPeriodEnd: string | null,
  nowMs: number
): number | null {
  if (status !== "trialing") return null

  const end = trialEnd ?? currentPeriodEnd
  if (!end) return null
  const endMs = new Date(end).getTime()
  if (!Number.isFinite(endMs)) return null
  return Math.max(0, Math.ceil((endMs - nowMs) / DAY_MS))
}

export function buildSubscriptionSnapshot(
  row: SubscriptionRowSnapshot | null | undefined,
  nowMs = Date.now()
): SubscriptionSnapshot {
  const status = normalizeSubscriptionStatus(row?.status)
  const trialEnd = row?.trial_end ?? row?.current_period_end ?? null

  return {
    plan: normalizeSubscriptionPlan(row?.plan),
    status,
    currentPeriodEnd: row?.current_period_end ?? null,
    billingInterval: normalizeBillingInterval(row?.billing_interval),
    amountCents: typeof row?.amount_cents === "number" ? row.amount_cents : null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    trialEnd,
    trialDaysRemaining: computeTrialDaysRemaining(status, trialEnd, row?.current_period_end ?? null, nowMs),
  }
}

function pushIssue(
  issues: SubscriptionConsistencyIssue[],
  code: string,
  message: string
): void {
  issues.push({ code, message })
}

export function evaluateSubscriptionSnapshotConsistency(
  snapshot: SubscriptionSnapshot
): SubscriptionConsistencyResult {
  const issues: SubscriptionConsistencyIssue[] = []
  const isPaidPlan = PAID_PLAN_SET.has(snapshot.plan)
  const isActiveStatus = ACTIVE_STATUS_SET.has(snapshot.status)

  if (isPaidPlan && snapshot.status === "free") {
    pushIssue(
      issues,
      "paid_plan_with_free_status",
      "Plan is paid but status resolved to free."
    )
  }

  if (!isPaidPlan && isActiveStatus) {
    pushIssue(
      issues,
      "free_plan_with_paid_status",
      "Plan is free while status is an active paid-state."
    )
  }

  if (isPaidPlan) {
    if (!snapshot.billingInterval) {
      pushIssue(
        issues,
        "missing_billing_interval",
        "Paid plan is missing billing interval."
      )
    } else {
      const expected = getPlanAmountCents(snapshot.plan, snapshot.billingInterval)
      if (typeof snapshot.amountCents !== "number") {
        pushIssue(
          issues,
          "missing_amount_cents",
          "Paid plan is missing amount_cents."
        )
      } else if (snapshot.amountCents !== expected) {
        pushIssue(
          issues,
          "amount_mismatch",
          `Amount ${snapshot.amountCents} does not match expected ${expected} for ${snapshot.plan}/${snapshot.billingInterval}.`
        )
      }
    }
  }

  if (!isPaidPlan) {
    if (typeof snapshot.amountCents === "number" && snapshot.amountCents > 0) {
      pushIssue(
        issues,
        "free_plan_with_positive_amount",
        "Free plan has a positive amount."
      )
    }
    if (snapshot.billingInterval) {
      pushIssue(
        issues,
        "free_plan_with_interval",
        "Free plan has a billing interval."
      )
    }
  }

  if (snapshot.status === "trialing" && !snapshot.trialEnd) {
    pushIssue(
      issues,
      "trialing_missing_trial_end",
      "Trialing subscription is missing trial end date."
    )
  }

  if (snapshot.status === "canceled" && !snapshot.currentPeriodEnd) {
    pushIssue(
      issues,
      "canceled_missing_period_end",
      "Canceled subscription is missing current period end."
    )
  }

  if (snapshot.cancelAtPeriodEnd && snapshot.status === "free") {
    pushIssue(
      issues,
      "free_status_with_cancel_flag",
      "cancel_at_period_end is true while status is free."
    )
  }

  return {
    ok: issues.length === 0,
    issues,
  }
}
