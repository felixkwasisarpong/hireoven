import assert from "node:assert/strict"
import test from "node:test"
import { scoreApplicationXRay } from "./scorer"
import type { ApplicationXRay } from "./types"
import { baseInputForTraceTests } from "./test-helpers"

/**
 * The decision trace is only worth carrying if it can stand in for the run that
 * produced it. These tests hold it to that: the fired rule must record the
 * values its condition read, and replaying those values must reproduce the
 * action and the rule id without re-deriving anything from the dimensions.
 */

// Rebuilt from decision-table.md §4. Deliberately a separate expression of the
// table from decision-engine.ts, so a replay agreeing with the engine is
// evidence about the trace rather than a tautology.
function replayFromTrace(xray: ApplicationXRay): { action: string; ruleId: string } {
  const row = xray.decisionTrace.evaluated.find((entry) => entry.outcome === "selected_action")
  assert.ok(row, "trace has no selected_action row")
  assert.ok(row.firedRuleId, "selected row has no firedRuleId")
  const i = row.inputs

  switch (row.firedRuleId) {
    case "RB1":
      assert.equal(i.isActive, false)
      assert.ok(i.closedAt !== null || String(i.publicationStatus ?? "").startsWith("hidden_"))
      return { action: "SKIP", ruleId: "RB1" }
    case "RC1":
      assert.equal(i.conflictDecisive, true)
      assert.equal(i.conflict, "conflict_now")
      return { action: "SKIP", ruleId: "RC1" }
    case "RC2":
      assert.equal(i.conflictDecisive, true)
      assert.equal(i.conflict, "conflict_future")
      return { action: "SKIP", ruleId: "RC2" }
    case "RC3":
      assert.equal(i.hardReqAbsent, true)
      return { action: "SKIP", ruleId: "RC3" }
    case "RC4":
      assert.equal(i.requiredActionRefused, true)
      return { action: "SKIP", ruleId: "RC4" }
    case "RD1":
      assert.equal(i.sufficient, false)
      return { action: "INSUFFICIENT_DATA", ruleId: "RD1" }
    case "RD2":
      assert.equal(i.sufficient, true)
      assert.equal(i.blockingConfirmation, true)
      return { action: "INSUFFICIENT_DATA", ruleId: "RD2" }
    case "RE1":
      assert.equal(i.mismatchCorroborated, true)
      assert.ok(Number(i.corroborationCount) >= 2)
      return { action: "SKIP", ruleId: "RE1" }
    case "RE2":
      assert.equal(i.capabilityBand, "STRETCH")
      assert.equal(i.years, "severe")
      return { action: "STRENGTHEN_FIRST", ruleId: "RE2" }
    case "RE3":
      assert.equal(i.reqUnconfirmed, true)
      assert.equal(i.sufficient, true)
      return { action: "STRENGTHEN_FIRST", ruleId: "RE3" }
    case "RE4":
      assert.equal(i.acquirableAbsent, true)
      return { action: "STRENGTHEN_FIRST", ruleId: "RE4" }
    case "RF1":
      assert.equal(i.evidenceBand, "UNREADABLE")
      return { action: "STRENGTHEN_FIRST", ruleId: "RF1" }
    case "RF2":
      assert.equal(i.evidenceBand, "BURIED")
      return { action: "STRENGTHEN_FIRST", ruleId: "RF2" }
    case "RF3":
      assert.equal(i.evidenceBand, "THIN")
      return { action: "STRENGTHEN_FIRST", ruleId: "RF3" }
    case "RG1":
      assert.equal(i.positioningBand, "MISALIGNED")
      assert.equal(i.repairable, true)
      return { action: "STRENGTHEN_FIRST", ruleId: "RG1" }
    case "RG2":
      assert.equal(i.positioningBand, "TUNABLE")
      return { action: "STRENGTHEN_FIRST", ruleId: "RG2" }
    case "RH1":
      assert.ok(Number(i.routeCount) >= 1)
      return { action: "FIND_ACCESS", ruleId: "RH1" }
    case "RI1":
      assert.ok(i.hiringRealityBand === "UNCERTAIN" || i.hiringRealityBand === "LIKELY_CLOSED")
      return { action: "APPLY_NOW", ruleId: "RI1" }
    case "RI2":
      return { action: "APPLY_NOW", ruleId: "RI2" }
    default:
      throw new Error(`replay does not cover rule ${row.firedRuleId}`)
  }
}

test("the fired rule records non-empty inputs", () => {
  for (const scenario of scenarios()) {
    const xray = scoreApplicationXRay(scenario.input)
    const row = xray.decisionTrace.evaluated.find((entry) => entry.outcome === "selected_action")
    assert.ok(row, `${scenario.name}: no selected row`)
    assert.ok(
      Object.keys(row.inputs).length > 0,
      `${scenario.name}: rule ${row.firedRuleId} recorded no inputs — the trace cannot explain the decision`,
    )
  }
})

test("replaying the trace reproduces finalAction and selectedRuleId", () => {
  for (const scenario of scenarios()) {
    const xray = scoreApplicationXRay(scenario.input)
    const replayed = replayFromTrace(xray)
    assert.equal(
      replayed.ruleId,
      xray.decisionTrace.selectedRuleId,
      `${scenario.name}: replayed rule ${replayed.ruleId} != ${xray.decisionTrace.selectedRuleId}`,
    )
    assert.equal(
      replayed.action,
      xray.finalAction,
      `${scenario.name}: replayed action ${replayed.action} != ${xray.finalAction}`,
    )
  }
})

test("every evaluated stage carries inputs, including pass-throughs", () => {
  const xray = scoreApplicationXRay(scenarios()[0]!.input)
  for (const row of xray.decisionTrace.evaluated) {
    if (row.stage === "A_canonical_resolution") continue
    assert.ok(
      Object.keys(row.inputs).length > 0,
      `stage ${row.stage} passed through with no recorded inputs`,
    )
  }
})

function scenarios(): Array<{ name: string; input: ReturnType<typeof buildInput> }> {
  const out: Array<{ name: string; input: ReturnType<typeof buildInput> }> = []
  out.push({ name: "baseline", input: buildInput() })

  const closed = buildInput()
  closed.jobRecords[0]!.availability.isActive = false
  closed.jobRecords[0]!.availability.closedAt = "2026-08-01T00:00:00.000Z"
  closed.jobRecords[0]!.availability.closedAtReliable = true
  closed.jobRecords[0]!.availability.publicationStatus = "hidden_expired"
  out.push({ name: "closed", input: closed })

  const unreadable = buildInput()
  unreadable.resume = null
  unreadable.capability.careerFitScore = null
  out.push({ name: "no-resume", input: unreadable })

  return out
}

function buildInput() {
  return baseInputForTraceTests()
}
