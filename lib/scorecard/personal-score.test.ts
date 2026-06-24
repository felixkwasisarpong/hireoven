import test from "node:test"
import assert from "node:assert/strict"
import { computePersonalScore, personalScoreBucket } from "@/lib/scorecard/personal-score"

// Archetypes double as documentation of what the score means. Grades are asserted as
// acceptable SETS (calibration target per decision 1), not exact letters.

test("new-grad SWE (React/TS, 1yr, BS STEM, work auth) — B family, never F", () => {
  const r = computePersonalScore({
    matched_postings: 9000,
    skill_demands: [12000, 9000, 8000],
    skills: ["React", "TypeScript", "JavaScript"],
    years_of_experience: 1,
    seniority_level: "junior",
    degree_level: "bachelors",
    is_stem: true,
    has_us_work_auth: true,
  })
  assert.ok(["C", "B", "B+"].includes(r.bucket.grade), `got ${r.bucket.grade} (${r.total})`)
})

test("8yr ML engineer (Rust/CUDA, MS STEM, senior) — A or A+", () => {
  const r = computePersonalScore({
    matched_postings: 1500,
    skill_demands: [400, 250, 600, 1500],
    skills: ["Rust", "CUDA", "Triton", "PyTorch"],
    years_of_experience: 8,
    seniority_level: "senior",
    degree_level: "masters",
    is_stem: true,
    has_us_work_auth: true,
  })
  assert.ok(["A", "A+"].includes(r.bucket.grade), `got ${r.bucket.grade} (${r.total})`)
  assert.equal(r.components.experience.alignment, "fit")
})

test("bootcamp grad (HTML/CSS, 0yr, no degree) — floors at C, kind label", () => {
  const r = computePersonalScore({
    matched_postings: 5000,
    skill_demands: [15000, 14000],
    skills: ["HTML", "CSS"],
    years_of_experience: 0,
    seniority_level: "junior",
    degree_level: "none",
    is_stem: false,
    has_us_work_auth: false,
  })
  assert.equal(r.bucket.grade, "C")
  assert.equal(r.bucket.label, "Building Profile")
})

test("PhD computational biology (Python/bioinformatics, 6yr, senior) — A or A+", () => {
  const r = computePersonalScore({
    matched_postings: 800,
    skill_demands: [6000, 200, 150],
    skills: ["Python", "Bioinformatics", "Genomics"],
    years_of_experience: 6,
    seniority_level: "senior",
    degree_level: "phd",
    is_stem: true,
    has_us_work_auth: true,
  })
  assert.ok(["A", "A+"].includes(r.bucket.grade), `got ${r.bucket.grade} (${r.total})`)
  assert.equal(r.components.rarity.rarest_skill, "Genomics")
})

test("ladder has no D/F and floors at C", () => {
  for (const total of [0, 20, 40, 63]) {
    assert.equal(personalScoreBucket(total).grade, "C")
  }
  assert.equal(personalScoreBucket(95).grade, "A+")
  // every bucket uses a kind, non-pejorative label
  for (const total of [0, 70, 100]) {
    const b = personalScoreBucket(total)
    assert.ok(!/limited|unlikely|poor|weak/i.test(b.label), b.label)
  }
})

test("strongest component is surfaced for page framing", () => {
  const r = computePersonalScore({
    matched_postings: 20000,
    skill_demands: [20000],
    skills: ["JavaScript"],
    years_of_experience: 1,
    seniority_level: "junior",
    degree_level: "none",
    is_stem: false,
    has_us_work_auth: false,
  })
  assert.equal(r.strongest.key, "demand")
  assert.ok(r.strongest.label.length > 0)
})
