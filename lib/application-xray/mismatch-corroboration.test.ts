import assert from "node:assert/strict"
import test from "node:test"
import { mismatchIsCorroborated, isStructuralCorroboration } from "./capability"
import { detectTrackIncompatibility, detectPostingTrack } from "./career-track"
import { scoreApplicationXRay } from "./scorer"
import { baseInputForTraceTests } from "./test-helpers"

/**
 * RE1 skips a job on the strength of a capability mismatch, so what counts as
 * corroboration matters more than the threshold. A low career-fit score is our
 * own weighted sum crossing a line we chose; it may support a mismatch that
 * something structural established, but on its own it is far likelier to be a
 * scoring artefact than a candidate in the wrong lane.
 */

test("career_fit_below_floor is not structural", () => {
  assert.equal(isStructuralCorroboration("career_fit_below_floor"), false)
  for (const structural of ["role_family_incompatible", "severe_years_shortfall", "mandatory_absent_confirmed"] as const) {
    assert.equal(isStructuralCorroboration(structural), true, structural)
  }
})

test("a low score alone never corroborates a mismatch", () => {
  assert.equal(mismatchIsCorroborated(["career_fit_below_floor"]), false)
})

test("two corroborations both non-structural still do not corroborate", () => {
  // Duplicates must not be counted twice into the threshold.
  assert.equal(mismatchIsCorroborated(["career_fit_below_floor", "career_fit_below_floor"]), false)
})

test("one structural plus the score corroborates", () => {
  assert.equal(mismatchIsCorroborated(["role_family_incompatible", "career_fit_below_floor"]), true)
  assert.equal(mismatchIsCorroborated(["severe_years_shortfall", "career_fit_below_floor"]), true)
})

test("a single structural corroboration is not enough on its own", () => {
  assert.equal(mismatchIsCorroborated(["role_family_incompatible"]), false)
})

// ─── A. backend candidate, backend role, score 26 ───────────────────────────

test("A: careerFitScore=26 on an in-lane backend role does not reach RE1", () => {
  const input = baseInputForTraceTests()
  input.capability.careerFitScore = 26
  input.capability.mismatchCorroborations = ["career_fit_below_floor"]
  const xray = scoreApplicationXRay(input)
  assert.notEqual(
    xray.decisionTrace.selectedRuleId,
    "RE1",
    "a low score with no structural reason must not skip an in-lane role",
  )
})

// ─── B. backend candidate, engineering-management role, no mgmt evidence ────

test("B: management posting with no management evidence supplies the structural corroboration", () => {
  const verdict = detectTrackIncompatibility({
    postingTitle: "Engineering Manager, (Apple/Android), SDK",
    postingDescription: "Lead, mentor, coach, and sponsor a team of 4-6 engineers.",
    candidateTitles: ["Senior Software Engineer", "Software Engineer", "Backend Developer"],
    candidateExperienceText: "Built payment APIs in Java and Spring. Designed microservices.",
    candidateDataReadable: true,
  })
  assert.ok(verdict, "verdict expected for a management posting")
  assert.equal(verdict.incompatible, true)
  assert.match(verdict.explanation, /people-management role/i)
  assert.match(verdict.explanation, /not a gap in skill/i)
})

test("B: RE1 fires on role_family_incompatible + career_fit_below_floor", () => {
  const input = baseInputForTraceTests()
  input.capability.careerFitScore = 26
  input.capability.mismatchCorroborations = ["role_family_incompatible", "career_fit_below_floor"]
  const xray = scoreApplicationXRay(input)
  assert.equal(xray.decisionTrace.selectedRuleId, "RE1")
  assert.equal(xray.finalAction, "SKIP")
  const row = xray.decisionTrace.evaluated.find((e) => e.outcome === "selected_action")
  assert.equal(row?.inputs.structuralCount, 1, "the trace must show which corroboration was structural")
  assert.match(String(row?.inputs.structuralCorroborations), /role_family_incompatible/)
})

// ─── C. management title, candidate HAS management history ──────────────────

test("C: a Manager title does not imply incompatibility when the resume shows management", () => {
  const verdict = detectTrackIncompatibility({
    postingTitle: "Engineering Manager, Platform",
    postingDescription: "Lead a team of engineers. Own headcount and performance reviews.",
    candidateTitles: ["Engineering Manager", "Senior Software Engineer"],
    candidateExperienceText: "Managed a team of 8 engineers with direct reports and performance reviews.",
    candidateDataReadable: true,
  })
  assert.ok(verdict)
  assert.equal(verdict.incompatible, false, "management history must clear the track check")
})

test("C: the word Manager alone never establishes incompatibility", () => {
  // Evidence in free text, not in a title.
  const verdict = detectTrackIncompatibility({
    postingTitle: "Manager, Data Platform",
    postingDescription: "Own the roadmap.",
    candidateTitles: ["Staff Engineer"],
    candidateExperienceText: "Led a team of 5 engineers delivering the billing platform.",
    candidateDataReadable: true,
  })
  assert.equal(verdict?.incompatible, false)
})

test("an unreadable resume can never manufacture a track incompatibility", () => {
  const verdict = detectTrackIncompatibility({
    postingTitle: "Engineering Manager",
    postingDescription: "Lead a team.",
    candidateTitles: [],
    candidateExperienceText: null,
    candidateDataReadable: false,
  })
  assert.equal(verdict, null, "unknown candidate data must not become a structural mismatch")
})

test("senior IC titles are not read as management", () => {
  for (const title of ["Tech Lead", "Lead Engineer", "Staff Engineer", "Principal Engineer"]) {
    assert.equal(
      detectPostingTrack({ title, description: "Build and ship services." }).track,
      "individual_contributor",
      title,
    )
  }
})
