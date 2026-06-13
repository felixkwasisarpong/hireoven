import test from "node:test"
import assert from "node:assert/strict"
import { computeSkillGaps, courseFor, MIN_JOBS_FOR_GAP, type SkillGapJob } from "@/lib/grow/skill-gap"

function job(id: string, skills: string[], salary: number | null = null): SkillGapJob {
  return { jobId: id, requiredSkills: skills, salary }
}

test("ranks the skill that unlocks the most one-away roles first", () => {
  const jobs = [
    job("1", ["React", "TypeScript", "Kubernetes"]), // missing only Kubernetes
    job("2", ["React", "TypeScript", "Kubernetes"]), // missing only Kubernetes
    job("3", ["React", "TypeScript", "Kubernetes"]), // missing only Kubernetes
    job("4", ["React", "Go", "Kafka"]),              // missing Go + Kafka (not one-away)
  ]
  const r = computeSkillGaps(jobs, ["react", "typescript"])
  assert.equal(r.gaps[0].skill, "Kubernetes")
  assert.equal(r.gaps[0].oneAway, 3)
  assert.equal(r.gaps[0].jobsRequiring, 3)
})

test("counts eligibleNow when the user has every listed skill", () => {
  const jobs = [job("1", ["React", "TypeScript"]), job("2", ["React", "Rust"])]
  const r = computeSkillGaps(jobs, ["react", "typescript"])
  assert.equal(r.eligibleNow, 1) // job 1 fully covered, job 2 needs Rust
})

test("ignores skills below the demand floor", () => {
  const jobs = [job("1", ["Cobol", "React"]), job("2", ["React"])]
  const r = computeSkillGaps(jobs, ["react"])
  assert.ok(MIN_JOBS_FOR_GAP > 1)
  assert.equal(r.gaps.find((g) => g.skill === "Cobol"), undefined)
})

test("computes median salary and signed uplift for a gap skill", () => {
  const jobs = [
    job("1", ["React", "Kubernetes"], 200_000),
    job("2", ["React", "Kubernetes"], 220_000),
    job("3", ["React", "Kubernetes"], 240_000),
    job("4", ["React"], 120_000),
  ]
  const r = computeSkillGaps(jobs, ["react"])
  const k = r.gaps.find((g) => g.skill === "Kubernetes")!
  assert.equal(k.medianSalary, 220_000)
  // overall median across [120,200,220,240]k = 210k → uplift +10k
  assert.equal(k.salaryUplift, 10_000)
})

test("is case-insensitive on the user's existing skills", () => {
  const jobs = [job("1", ["React", "Kubernetes"]), job("2", ["React", "Kubernetes"]), job("3", ["React", "Kubernetes"])]
  const r = computeSkillGaps(jobs, ["REACT", "KUBERNETES"])
  assert.equal(r.gaps.length, 0)
  assert.equal(r.eligibleNow, 3)
})

test("does not double-count a skill listed twice in one posting", () => {
  const jobs = [
    job("1", ["Kubernetes", "kubernetes", "React"]),
    job("2", ["Kubernetes", "React"]),
    job("3", ["Kubernetes", "React"]),
  ]
  const r = computeSkillGaps(jobs, ["react"])
  const k = r.gaps.find((g) => g.skill === "Kubernetes")!
  assert.equal(k.jobsRequiring, 3)
  assert.equal(k.oneAway, 3)
})

test("courseFor returns a catalog hit for known skills and a search fallback otherwise", () => {
  assert.match(courseFor("Kubernetes").url, /coursera|kubernetes/i)
  const fallback = courseFor("Obscurelang")
  assert.match(fallback.url, /coursera\.org\/search/i)
  assert.match(fallback.title, /Obscurelang/)
})
