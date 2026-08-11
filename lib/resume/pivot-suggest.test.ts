import { strict as assert } from "node:assert"
import { test } from "node:test"
import { suggestPivotTarget } from "./pivot-suggest"
import type { FieldFit, FieldProfile, ResumeSignal } from "@/lib/resume/signal"

function fit(over: Partial<FieldFit> & Pick<FieldFit, "key" | "label" | "score">): FieldFit {
  return { matched: [], missing: [], ...over }
}
// scoreResumeAgainstProfiles always returns fields sorted by fit desc — mirror that.
function sig(fields: FieldFit[]): ResumeSignal {
  const sorted = [...fields].sort((a, b) => b.score - a.score)
  return { fields: sorted, primary: sorted[0] ?? null, runnerUp: sorted[1] ?? null, split: false }
}
function profile(key: string, jobCount: number, sponsorshipShare?: number): FieldProfile {
  return { key, label: key, jobCount, sponsorshipShare, skills: [] }
}

test("real-world generalist: low compressed scores still yield a demand pivot", () => {
  // Mirrors an actual generalist resume: top field only 42%, split signal.
  const signal = sig([
    fit({ key: "devops", label: "DevOps", score: 42, sponsorshipShare: 0.55 }),
    fit({ key: "backend", label: "Backend", score: 33, missing: ["data engineering", "llms"], sponsorshipShare: 0.47 }),
    fit({ key: "data", label: "Data", score: 27, missing: ["airflow"], sponsorshipShare: 0.48 }),
  ])
  const profiles = [profile("devops", 22686, 0.55), profile("backend", 32463, 0.47), profile("data", 24541, 0.48)]
  const s = suggestPivotTarget(signal, profiles)
  assert.ok(s, "expected a suggestion for a generalist with a bigger adjacent field")
  assert.equal(s!.toKey, "backend")
  assert.equal(s!.driver, "demand")
  assert.equal(s!.jobMultiple, 1.4)
})

test("adjacency is relative to the primary's own strength", () => {
  // Focused resume: primary 55, an adjacent 40 (73% of primary) clears the bar.
  const signal = sig([
    fit({ key: "frontend", label: "Frontend", score: 55, sponsorshipShare: 0.42 }),
    fit({ key: "backend", label: "Backend", score: 40, missing: ["Go", "Kubernetes", "SQL"], sponsorshipShare: 0.47 }),
  ])
  const profiles = [profile("frontend", 24000, 0.42), profile("backend", 32000, 0.47)]
  const s = suggestPivotTarget(signal, profiles)
  assert.ok(s)
  assert.equal(s!.toKey, "backend")
  assert.deepEqual(s!.bridgeSkills, ["Go", "Kubernetes", "SQL"])
})

test("filters JD-boilerplate soft skills out of the bridge list", () => {
  const signal = sig([
    fit({ key: "frontend", label: "Frontend", score: 55, sponsorshipShare: 0.42 }),
    fit({
      key: "backend",
      label: "Backend",
      score: 44,
      missing: ["communication", "leadership", "Go", "recruiting", "Kubernetes"],
      sponsorshipShare: 0.47,
    }),
  ])
  const profiles = [profile("frontend", 24000, 0.42), profile("backend", 32000, 0.47)]
  const s = suggestPivotTarget(signal, profiles)
  assert.ok(s)
  assert.deepEqual(s!.bridgeSkills, ["Go", "Kubernetes"], "soft-skill noise must be stripped")
})

test("surfaces a sponsorship pivot even when the target is a bit smaller", () => {
  const signal = sig([
    fit({ key: "backend", label: "Backend", score: 60, sponsorshipShare: 0.47 }),
    fit({ key: "mobile", label: "Mobile", score: 45, missing: ["Swift", "Kotlin"], sponsorshipShare: 0.65 }),
  ])
  const profiles = [profile("backend", 32000, 0.47), profile("mobile", 20000, 0.65)]
  const s = suggestPivotTarget(signal, profiles)
  assert.ok(s)
  assert.equal(s!.toKey, "mobile")
  assert.equal(s!.driver, "sponsorship")
  assert.equal(s!.sponsorDelta, 18)
})

test("returns null on a strictly-worse move (fewer jobs, no visa upside)", () => {
  const signal = sig([
    fit({ key: "ai_ml", label: "AI / ML", score: 60, sponsorshipShare: 0.49 }),
    fit({ key: "data", label: "Data", score: 50, missing: ["Airflow"], sponsorshipShare: 0.48 }),
  ])
  const profiles = [profile("ai_ml", 43000, 0.49), profile("data", 24000, 0.48)]
  assert.equal(suggestPivotTarget(signal, profiles), null)
})

test("ignores thin fields below the job floor", () => {
  const signal = sig([
    fit({ key: "backend", label: "Backend", score: 60, sponsorshipShare: 0.47 }),
    fit({ key: "mobile", label: "Mobile", score: 50, missing: ["Swift"], sponsorshipShare: 0.65 }),
  ])
  const profiles = [profile("backend", 32000, 0.47), profile("mobile", 1500, 0.65)] // below MIN_TARGET_JOBS
  assert.equal(suggestPivotTarget(signal, profiles), null)
})

test("returns null without a corpus, or when the primary signal is too weak", () => {
  const signal = sig([fit({ key: "backend", label: "Backend", score: 60 })])
  assert.equal(suggestPivotTarget(signal, []), null)
  const weak = sig([
    fit({ key: "backend", label: "Backend", score: 30 }), // below MIN_PRIMARY_FIT
    fit({ key: "frontend", label: "Frontend", score: 25, missing: ["React"] }),
  ])
  assert.equal(suggestPivotTarget(weak, [profile("backend", 32000), profile("frontend", 40000)]), null)
})

test("a near-tie runner-up with more openings is a valid nudge (lean in)", () => {
  // When two fields nearly tie and the runner-up has more demand, nudging toward
  // it is honest ("you're basically already here, and it has more openings").
  const signal = sig([
    fit({ key: "devops", label: "DevOps", score: 50, sponsorshipShare: 0.55 }),
    fit({ key: "backend", label: "Backend", score: 47, missing: ["Go"], sponsorshipShare: 0.47 }),
  ])
  const profiles = [profile("devops", 22000, 0.55), profile("backend", 32000, 0.47)]
  const s = suggestPivotTarget(signal, profiles)
  assert.ok(s)
  assert.equal(s!.toKey, "backend")
  assert.equal(s!.driver, "demand")
})
