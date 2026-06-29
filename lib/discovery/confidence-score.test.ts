import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { fastPathDecision } from "@/lib/discovery/confidence-score"

describe("fastPathDecision", () => {
  it("enrolls a high-trust ATS with a confirmed job count", () => {
    const r = fastPathDecision({ atsType: "greenhouse", endpointStatus: "ok", jobCount: 12 })
    assert.deepEqual(r, { fastPath: true, confidence: 90, decision: "enroll" })
  })

  it("retries_later when the board is empty", () => {
    const r = fastPathDecision({ atsType: "lever", endpointStatus: "empty", jobCount: 0 })
    assert.deepEqual(r, { fastPath: true, confidence: 60, decision: "retry_later" })
  })

  it("falls through on endpoint error", () => {
    const r = fastPathDecision({ atsType: "ashby", endpointStatus: "error", jobCount: 0 })
    assert.deepEqual(r, { fastPath: false, confidence: 0, decision: "fallthrough" })
  })

  it("falls through on unknown status", () => {
    const r = fastPathDecision({ atsType: "workable", endpointStatus: "unknown", jobCount: 5 })
    assert.deepEqual(r, { fastPath: false, confidence: 0, decision: "fallthrough" })
  })

  it("falls through for an ATS not on the fast-path allowlist", () => {
    const r = fastPathDecision({ atsType: "workday", endpointStatus: "ok", jobCount: 50 })
    assert.deepEqual(r, { fastPath: false, confidence: 0, decision: "fallthrough" })
  })

  it("falls through when atsType is null", () => {
    const r = fastPathDecision({ atsType: null, endpointStatus: "ok", jobCount: 9 })
    assert.deepEqual(r, { fastPath: false, confidence: 0, decision: "fallthrough" })
  })

  it("falls through when status is 'ok' but no jobs (not an enroll, not empty)", () => {
    // ok + 0 jobs is an unusual combination: not enroll (needs >=1), not the
    // 'empty' signal — so it falls through to the heuristic path.
    const r = fastPathDecision({ atsType: "greenhouse", endpointStatus: "ok", jobCount: 0 })
    assert.deepEqual(r, { fastPath: false, confidence: 0, decision: "fallthrough" })
  })

  it("covers every fast-path ATS", () => {
    for (const ats of ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "bamboohr", "recruitee", "teamtailor"]) {
      assert.equal(fastPathDecision({ atsType: ats, endpointStatus: "ok", jobCount: 1 }).decision, "enroll")
    }
  })
})
