import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  countScraperArtifactRows,
  countSubscriptionSnapshotMismatches,
  toRateMetric,
} from "./reliability-metrics"

test("toRateMetric: calculates rounded percentage", () => {
  const metric = toRateMetric(3, 200)
  assert.equal(metric.numerator, 3)
  assert.equal(metric.denominator, 200)
  assert.equal(metric.ratePercent, 1.5)
})

test("toRateMetric: handles zero denominator safely", () => {
  const metric = toRateMetric(4, 0)
  assert.equal(metric.ratePercent, 0)
  assert.equal(metric.denominator, 0)
})

test("countSubscriptionSnapshotMismatches: flags inconsistent snapshots", () => {
  const result = countSubscriptionSnapshotMismatches([
    {
      user_id: "u1",
      plan: "pro",
      status: "active",
      current_period_end: "2026-06-30T00:00:00.000Z",
      billing_interval: "monthly",
      amount_cents: 1900,
      cancel_at_period_end: false,
      trial_end: null,
    },
    {
      user_id: "u2",
      plan: "free",
      status: "active",
      current_period_end: null,
      billing_interval: "monthly",
      amount_cents: 1900,
      cancel_at_period_end: false,
      trial_end: null,
    },
  ])

  assert.equal(result.trackedSnapshots, 2)
  assert.equal(result.mismatchedSnapshots, 1)
})

test("countScraperArtifactRows: counts blocked title and blocked apply URL artifacts", () => {
  const count = countScraperArtifactRows([
    { title: "Go to last page", apply_url: "https://jobs.example.com/123" },
    { title: "Software Engineer", apply_url: "https://www.linkedin.com/jobs/foo-jobs?trk=public_jobs_linkster_link" },
    { title: "Senior Product Manager", apply_url: "https://boards.greenhouse.io/company/jobs/123" },
  ])

  assert.equal(count, 2)
})
