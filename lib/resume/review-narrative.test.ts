import { strict as assert } from "node:assert"
import { test } from "node:test"
import { deterministicNarrative, mergeNarrative, parseNarrative } from "./review-narrative"
import type { ResumeFinding, ResumeReview } from "./review"

function finding(over: Partial<ResumeFinding> & Pick<ResumeFinding, "id">): ResumeFinding {
  return {
    severity: "major",
    weight: 50,
    title: "Title",
    observation: "Observation.",
    cost: "Cost.",
    evidence: ["evidence"],
    fix: "Fix it like this.",
    ...over,
  }
}

function review(findings: ResumeFinding[]): ResumeReview {
  return {
    findings,
    blockers: findings.filter((f) => f.severity === "blocker").length,
    majors: findings.filter((f) => f.severity === "major").length,
    readsAs: "Backend Engineering",
    documentKind: "resume",
    documentKindLabel: "Resume",
    documentKindSignals: [],
    verdict: "Verdict line.",
  }
}

const ALLOWED = new Set(["split_signal", "too_long"])

test("a well-formed response is accepted and marked as ai-sourced", () => {
  const out = parseNarrative(
    JSON.stringify({
      opening: "You are being filtered before anyone reads a bullet.",
      steps: [{ id: "split_signal", explanation: "Two lanes.", doThis: "Pick one." }],
      firstMove: "Pick a lane.",
    }),
    ALLOWED,
  )
  assert.ok(out)
  assert.equal(out.source, "ai")
  assert.equal(out.steps.length, 1)
  assert.equal(out.steps[0].id, "split_signal")
})

test("a step for a finding that was never computed is dropped", () => {
  const out = parseNarrative(
    JSON.stringify({
      opening: "Opening.",
      steps: [
        { id: "split_signal", explanation: "Real.", doThis: "Do." },
        { id: "invented_finding", explanation: "Made up.", doThis: "Do." },
        { id: "your_resume_is_ugly", explanation: "Also made up.", doThis: "Do." },
      ],
      firstMove: "Move.",
    }),
    ALLOWED,
  )
  assert.ok(out)
  assert.deepEqual(
    out.steps.map((s) => s.id),
    ["split_signal"],
    "only computed findings survive",
  )
})

test("prose wrapped around the JSON is tolerated", () => {
  const out = parseNarrative(
    'Here you go:\n```json\n{"opening":"O","steps":[{"id":"too_long","explanation":"E","doThis":"D"}],"firstMove":"F"}\n```',
    ALLOWED,
  )
  assert.ok(out)
  assert.equal(out.steps[0].id, "too_long")
})

test("unusable responses are rejected so the caller can fall back", () => {
  assert.equal(parseNarrative("no json here at all", ALLOWED), null)
  assert.equal(parseNarrative("{ not valid json", ALLOWED), null)
  assert.equal(parseNarrative(JSON.stringify({ steps: [], opening: "" }), ALLOWED), null)
  assert.equal(
    parseNarrative(JSON.stringify({ opening: "", steps: [{ id: "nope", explanation: "x", doThis: "y" }] }), ALLOWED),
    null,
    "an opening-less response whose every step was invented is unusable",
  )
})

test("a response with only an opening still counts — steps get back-filled later", () => {
  const out = parseNarrative(JSON.stringify({ opening: "Real opening.", steps: [] }), ALLOWED)
  assert.ok(out)
  assert.equal(out.steps.length, 0)
})

test("the deterministic narrative covers every finding without a model", () => {
  const r = review([finding({ id: "a" }), finding({ id: "b" })])
  const out = deterministicNarrative(r)
  assert.equal(out.source, "fallback")
  assert.equal(out.opening, "Verdict line.")
  assert.deepEqual(
    out.steps.map((s) => s.id),
    ["a", "b"],
  )
  assert.ok(out.steps[0].explanation.includes("Observation."))
  assert.ok(out.steps[0].explanation.includes("Cost."))
  assert.equal(out.firstMove, "Fix it like this.")
})

test("merging keeps one row per finding even when the model narrated none", () => {
  const r = review([finding({ id: "a" }), finding({ id: "b" })])
  const merged = mergeNarrative(r, { opening: "O", steps: [], firstMove: "", source: "ai" })
  assert.equal(merged.length, 2)
  for (const row of merged) {
    assert.ok(row.explanation.length > 0, "a silent model must not hide a finding")
    assert.ok(row.doThis.length > 0)
  }
})

test("merging prefers the narrated text where it exists", () => {
  const r = review([finding({ id: "a" }), finding({ id: "b" })])
  const merged = mergeNarrative(r, {
    opening: "O",
    steps: [{ id: "b", explanation: "Narrated B.", doThis: "Do B." }],
    firstMove: "",
    source: "ai",
  })
  assert.ok(merged[0].explanation.includes("Observation."), "a falls back")
  assert.equal(merged[1].explanation, "Narrated B.")
  assert.equal(merged[1].doThis, "Do B.")
})
