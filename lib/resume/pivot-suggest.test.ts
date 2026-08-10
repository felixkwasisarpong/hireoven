import { strict as assert } from "node:assert"
import { test } from "node:test"
import { suggestPivotTarget } from "./pivot-suggest"
import type { FieldFit, FieldProfile, ResumeSignal } from "@/lib/resume/signal"

function fit(over: Partial<FieldFit> & Pick<FieldFit, "key" | "label" | "score">): FieldFit {
  return { matched: [], missing: [], ...over }
}
function sig(fields: FieldFit[]): ResumeSignal {
  return { fields, primary: fields[0] ?? null, runnerUp: fields[1] ?? null, split: false }
}
function profile(key: string, jobCount: number, sponsorshipShare?: number): FieldProfile {
  return { key, label: key, jobCount, sponsorshipShare, skills: [] }
}

test("suggests an adjacent field with more openings", () => {
  const signal = sig([
    fit({ key: "frontend", label: "Frontend", score: 80, sponsorshipShare: 0.42 }),
    fit({ key: "backend", label: "Backend", score: 60, missing: ["Go", "Kubernetes", "SQL"], sponsorshipShare: 0.47 }),
  ])
  const profiles = [profile("frontend", 24000, 0.42), profile("backend", 32000, 0.47)]
  const s = suggestPivotTarget(signal, profiles)
  assert.ok(s)
  assert.equal(s!.toKey, "backend")
  assert.equal(s!.driver, "demand")
  assert.deepEqual(s!.bridgeSkills, ["Go", "Kubernetes", "SQL"])
  assert.ok(s!.jobMultiple > 1.25)
})

test("surfaces a sponsorship pivot even when the target is a bit smaller", () => {
  const signal = sig([
    fit({ key: "backend", label: "Backend", score: 78, sponsorshipShare: 0.47 }),
    fit({ key: "mobile", label: "Mobile", score: 55, missing: ["Swift", "Kotlin"], sponsorshipShare: 0.65 }),
  ])
  // mobile smaller but > half the size, +18pts sponsorship
  const profiles = [profile("backend", 32000, 0.47), profile("mobile", 20000, 0.65)]
  const s = suggestPivotTarget(signal, profiles)
  assert.ok(s)
  assert.equal(s!.toKey, "mobile")
  assert.equal(s!.driver, "sponsorship")
  assert.equal(s!.sponsorDelta, 18)
})

test("returns null when the current lane is already the strongest and biggest", () => {
  const signal = sig([
    fit({ key: "ai_ml", label: "AI / ML", score: 85, sponsorshipShare: 0.49 }),
    fit({ key: "data", label: "Data", score: 55, missing: ["Airflow"], sponsorshipShare: 0.48 }),
  ])
  const profiles = [profile("ai_ml", 43000, 0.49), profile("data", 24000, 0.48)]
  // data: fewer jobs, sponsorship delta -1pt → strictly worse, no nudge.
  assert.equal(suggestPivotTarget(signal, profiles), null)
})

test("ignores thin fields below the job floor", () => {
  const signal = sig([
    fit({ key: "backend", label: "Backend", score: 78, sponsorshipShare: 0.47 }),
    fit({ key: "mobile", label: "Mobile", score: 60, missing: ["Swift"], sponsorshipShare: 0.65 }),
  ])
  const profiles = [profile("backend", 32000, 0.47), profile("mobile", 1500, 0.65)] // below MIN_TARGET_JOBS
  assert.equal(suggestPivotTarget(signal, profiles), null)
})

test("returns null without a corpus (no profiles) or a weak primary signal", () => {
  const signal = sig([fit({ key: "backend", label: "Backend", score: 78 })])
  assert.equal(suggestPivotTarget(signal, []), null)
  const weak = sig([
    fit({ key: "backend", label: "Backend", score: 30 }),
    fit({ key: "frontend", label: "Frontend", score: 25, missing: ["React"] }),
  ])
  assert.equal(suggestPivotTarget(weak, [profile("backend", 32000), profile("frontend", 40000)]), null)
})

test("skips a co-primary (target fit too high to be a real pivot)", () => {
  const signal = sig([
    fit({ key: "backend", label: "Backend", score: 80, sponsorshipShare: 0.47 }),
    fit({ key: "devops", label: "DevOps", score: 95, missing: ["Terraform"], sponsorshipShare: 0.55 }),
  ])
  const profiles = [profile("backend", 32000, 0.47), profile("devops", 40000, 0.55)]
  // devops fit 95 > MAX_TARGET_FIT → not a pivot, it's already their identity.
  assert.equal(suggestPivotTarget(signal, profiles), null)
})
