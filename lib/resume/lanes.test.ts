import assert from "node:assert/strict"
import test from "node:test"
import { deriveLanes } from "@/lib/resume/lanes"
import type { FieldFit, FieldProfile, ResumeSignal } from "@/lib/resume/signal"

const fit = (over: Partial<FieldFit> & { key: string; label: string; score: number }): FieldFit => ({
  matched: [],
  missing: [],
  ...over,
})

const signalOf = (fields: FieldFit[], split = false): ResumeSignal => ({
  fields,
  primary: fields[0] ?? null,
  runnerUp: fields[1] ?? null,
  split,
})

test("offers the strongest field as the current lane", () => {
  const { lanes } = deriveLanes(signalOf([fit({ key: "backend", label: "Backend", score: 78 })]))
  assert.equal(lanes.length, 1)
  assert.equal(lanes[0]!.kind, "current")
  assert.equal(lanes[0]!.fit, 78)
})

test("a near-equal second field is adjacent, a distant one is a stretch", () => {
  const { lanes } = deriveLanes(
    signalOf([
      fit({ key: "backend", label: "Backend", score: 80 }),
      fit({ key: "ai_ml", label: "AI / ML", score: 72 }), // within 12
      fit({ key: "data", label: "Data", score: 40 }), // far below
    ])
  )
  assert.deepEqual(
    lanes.map((l) => l.kind),
    ["current", "adjacent", "stretch"]
  )
})

test("fields the résumé cannot support are not offered", () => {
  // Padding the picker with lanes the person has no claim to is how an optimizer
  // ends up sharpening toward a job they will not get called for.
  const { lanes } = deriveLanes(
    signalOf([
      fit({ key: "backend", label: "Backend", score: 70 }),
      fit({ key: "design", label: "Design", score: 9 }),
    ])
  )
  assert.deepEqual(lanes.map((l) => l.key), ["backend"])
})

test("live corpus numbers are attached when a profile exists", () => {
  const profiles: FieldProfile[] = [
    { key: "backend", label: "Backend", jobCount: 12400, sponsorshipShare: 0.42, skills: [] },
  ]
  const { lanes } = deriveLanes(
    signalOf([fit({ key: "backend", label: "Backend", score: 78 })]),
    profiles
  )
  assert.equal(lanes[0]!.jobCount, 12400)
  assert.equal(lanes[0]!.sponsorshipPct, 42)
  assert.match(lanes[0]!.rationale, /12,400 open roles/)
})

test("missing corpus data yields nulls, never invented numbers", () => {
  const { lanes } = deriveLanes(signalOf([fit({ key: "backend", label: "Backend", score: 78 })]))
  assert.equal(lanes[0]!.jobCount, null)
  assert.equal(lanes[0]!.sponsorshipPct, null)
  assert.doesNotMatch(lanes[0]!.rationale, /open roles/)
})

test("ambiguous only when the split flag AND the scores agree", () => {
  const close = [
    fit({ key: "backend", label: "Backend", score: 80 }),
    fit({ key: "ai_ml", label: "AI / ML", score: 74 }),
  ]
  assert.equal(deriveLanes(signalOf(close, true)).ambiguous, true)
  assert.equal(deriveLanes(signalOf(close, false)).ambiguous, false)

  // split=true but the runner-up is far behind — do not present a false either/or.
  const wide = [
    fit({ key: "backend", label: "Backend", score: 80 }),
    fit({ key: "data", label: "Data", score: 30 }),
  ]
  assert.equal(deriveLanes(signalOf(wide, true)).ambiguous, false)
})

test("no usable signal returns an empty picker rather than a fabricated one", () => {
  assert.deepEqual(deriveLanes(signalOf([])).lanes, [])
  assert.equal(deriveLanes(signalOf([])).ambiguous, false)
})

test("strengths and gaps carry through, bounded", () => {
  const { lanes } = deriveLanes(
    signalOf([
      fit({
        key: "backend",
        label: "Backend",
        score: 70,
        matched: ["kafka", "go", "kubernetes", "grpc", "postgres", "redis", "terraform", "spark"],
        missing: ["rust", "graphql", "kafka streams", "istio", "cassandra", "flink", "scala"],
      }),
    ])
  )
  assert.equal(lanes[0]!.strengths.length, 6)
  assert.equal(lanes[0]!.gaps.length, 6)
  assert.equal(lanes[0]!.strengths[0], "kafka")
})
