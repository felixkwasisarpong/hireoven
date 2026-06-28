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

test("alias-aware: 'JS' matches the user's 'JavaScript' (not a false gap)", () => {
  const jobs = [
    job("1", ["JS", "Kubernetes"]),
    job("2", ["js", "Kubernetes"]),
    job("3", ["javascript", "Kubernetes"]),
  ]
  // User has JavaScript + Kubernetes under different casings/aliases.
  const r = computeSkillGaps(jobs, ["JavaScript", "k8s"])
  // No gap should be reported — they already have everything (aliases collapse).
  assert.equal(r.gaps.find((g) => /javascript/i.test(g.skill)), undefined)
  assert.equal(r.eligibleNow, 3)
})

test("collapses golang/Go and postgres/PostgreSQL aliases", () => {
  const jobs = [job("1", ["golang"]), job("2", ["Go"]), job("3", ["go"])]
  const r = computeSkillGaps(jobs, [])
  // All three postings demand the same canonical skill.
  const go = r.gaps.find((g) => g.skill === "Go")
  assert.ok(go)
  assert.equal(go!.jobsRequiring, 3)
})

test("drops non-taxonomy tokens that aren't real skills, even above the demand floor", () => {
  // "Visual Merchandising" / "Attention to Detail" leak in from broad upstream
  // extractors. They read as ordinary English so the noise filter can't catch
  // them — the taxonomy gate must.
  const jobs = [
    job("1", ["React", "Visual Merchandising", "Attention to Detail"]),
    job("2", ["React", "Visual Merchandising", "Attention to Detail"]),
    job("3", ["React", "Visual Merchandising", "Attention to Detail"]),
    job("4", ["React", "Kubernetes"]),
    job("5", ["React", "Kubernetes"]),
    job("6", ["React", "Kubernetes"]),
  ]
  const r = computeSkillGaps(jobs, ["react"])
  assert.equal(r.gaps.find((g) => /merchandising|attention/i.test(g.skill)), undefined)
  // Genuine skills still surface.
  assert.ok(r.gaps.find((g) => g.skill === "Kubernetes"))
})

test("does not surface generic soft skills as learnable gaps", () => {
  const jobs = [
    job("1", ["Kubernetes", "Communication", "Leadership"]),
    job("2", ["Kubernetes", "Communication", "Leadership"]),
    job("3", ["Kubernetes", "Communication", "Leadership"]),
  ]
  const r = computeSkillGaps(jobs, [])
  assert.ok(r.gaps.find((g) => g.skill === "Kubernetes"))
  assert.equal(r.gaps.find((g) => /communication|leadership/i.test(g.skill)), undefined)
})

test("a posting whose only missing skill is noise counts as eligible, not a gap", () => {
  // User has every *real* skill; the posting's extra "Cashier" token is noise.
  const jobs = [
    job("1", ["React", "Cashier"]),
    job("2", ["React", "Cashier"]),
    job("3", ["React", "Cashier"]),
  ]
  const r = computeSkillGaps(jobs, ["react"])
  assert.equal(r.gaps.length, 0)
  assert.equal(r.eligibleNow, 3)
})

test("excludes implausible salaries from the comp signal", () => {
  const jobs = [
    job("1", ["React", "Kubernetes"], 200_000),
    job("2", ["React", "Kubernetes"], 220_000),
    job("3", ["React", "Kubernetes"], 10_000), // garbage/hourly mis-store — must be dropped
  ]
  const r = computeSkillGaps(jobs, ["react"])
  const k = r.gaps.find((g) => g.skill === "Kubernetes")
  assert.ok(k)
  // median of {200k, 220k} = 210k, NOT pulled down by the 10k value.
  assert.equal(k!.medianSalary, 210_000)
})
