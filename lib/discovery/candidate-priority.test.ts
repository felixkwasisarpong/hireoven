import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { candidatePriorityScore } from "@/lib/discovery/candidate-priority"

// These mirror the SQL ORDER BY used by discover-tenants. True end-to-end tests
// would need a test DB (the repo has none); these pin the scoring logic that
// drives claim order.

const base = {
  jobCount: 0,
  hasApplyUrl: false,
  hasRealDomain: false,
  discoveredVia: null as string | null,
  resolutionAttempts: 0,
  recentlyFailed: false,
}

describe("candidatePriorityScore", () => {
  it("placeholder with apply URL + 50 jobs → high priority (backsolver-eligible)", () => {
    const score = candidatePriorityScore({ ...base, jobCount: 50, hasApplyUrl: true, hasRealDomain: true })
    // 150 + 50 + 30 = 230
    assert.equal(score, 230)
  })

  it("placeholder with no apply URL + 100 jobs → high priority (slug probing)", () => {
    const score = candidatePriorityScore({ ...base, jobCount: 100, hasApplyUrl: false, hasRealDomain: true })
    // 300 + 30 = 330
    assert.equal(score, 330)
    // job-count volume alone outranks the apply-url+50-job case.
    const applyCase = candidatePriorityScore({ ...base, jobCount: 50, hasApplyUrl: true, hasRealDomain: true })
    assert.ok(score > applyCase)
  })

  it("placeholder attempted 5 times → heavy penalty, deprioritized", () => {
    const fresh = candidatePriorityScore({ ...base, jobCount: 20, hasApplyUrl: true, hasRealDomain: true })
    const exhausted = candidatePriorityScore({
      ...base,
      jobCount: 20,
      hasApplyUrl: true,
      hasRealDomain: true,
      resolutionAttempts: 5,
      recentlyFailed: true,
    })
    // penalty = min(5*20,100)=100 capped, plus 30 recent-fail = 130 lower
    assert.equal(fresh - exhausted, 130)
    assert.ok(exhausted < fresh)
  })

  it("adzuna-* (sentinel) domain → has_real_domain=false → lower than a real-domain twin", () => {
    const sentinel = candidatePriorityScore({ ...base, jobCount: 10, hasApplyUrl: true, hasRealDomain: false })
    const real = candidatePriorityScore({ ...base, jobCount: 10, hasApplyUrl: true, hasRealDomain: true })
    assert.equal(real - sentinel, 30)
    assert.ok(sentinel < real)
  })

  it("apply-url discovered_via adds a small boost", () => {
    const withVia = candidatePriorityScore({ ...base, jobCount: 0, discoveredVia: "apply-url:dice" })
    const without = candidatePriorityScore({ ...base, jobCount: 0, discoveredVia: "cron:builtin-discovery" })
    assert.equal(withVia - without, 20)
  })
})
