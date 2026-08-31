import test from "node:test"
import assert from "node:assert/strict"
import { parseResumeMonth, computeYearsOfExperience, buildDerivedFacts } from "./resume-facts"

const NOW = new Date("2026-08-30T00:00:00Z")

test("the date formats résumés actually use all parse", () => {
  assert.equal(parseResumeMonth("Mar 2026", NOW), 2026 * 12 + 2)
  assert.equal(parseResumeMonth("March 2026", NOW), 2026 * 12 + 2)
  assert.equal(parseResumeMonth("2026-03", NOW), 2026 * 12 + 2)
  assert.equal(parseResumeMonth("2020", NOW), 2020 * 12)
  assert.equal(parseResumeMonth("Present", NOW), 2026 * 12 + 7)
  assert.equal(parseResumeMonth("", NOW), null)
  assert.equal(parseResumeMonth("sometime last year", NOW), null)
})

test("years of experience is summed across separate roles", () => {
  const years = computeYearsOfExperience([
    { start_date: "Jan 2020", end_date: "Dec 2021" },   // 24 months
    { start_date: "Jan 2023", end_date: "Dec 2023" },   // 12 months
  ], NOW)
  assert.equal(years, 3)
})

test("overlapping roles are merged, not double counted", () => {
  // A part-time job alongside a full-time one is not two years in one year.
  // Summing would inflate the figure and put a false claim on an application.
  const overlapping = computeYearsOfExperience([
    { start_date: "Jan 2022", end_date: "Dec 2023" },
    { start_date: "Jun 2022", end_date: "Dec 2023" },
  ], NOW)
  assert.equal(overlapping, 2)
})

test("a current role runs to today", () => {
  const years = computeYearsOfExperience([
    { start_date: "Aug 2024", end_date: null, is_current: true },
  ], NOW)
  assert.equal(years, 2.1)
})

test("a future-dated start contributes nothing", () => {
  assert.equal(computeYearsOfExperience([{ start_date: "Jan 2030", end_date: "Jan 2032" }], NOW), 0)
})

test("unparseable or empty history yields zero rather than a guess", () => {
  assert.equal(computeYearsOfExperience([], NOW), 0)
  assert.equal(computeYearsOfExperience([{ start_date: null, end_date: null }], NOW), 0)
})

test("derived facts state the things forms actually ask about", () => {
  const block = buildDerivedFacts({
    yearsOfExperience: 6,
    primaryRole: "Software Engineer",
    topSkills: ["TypeScript", "Postgres"],
    workExperience: [{ title: "Engineer", company: "Acme", start_date: "Jan 2020", end_date: "Jan 2024" }],
    city: "Lubbock", state: "TX", country: "United States",
    highestDegree: "Bachelor's", fieldOfStudy: "Computer Science",
  }, NOW)
  assert.match(block, /6 years/)
  // The comparison instruction is what turns "4+ years?" into a Yes.
  assert.match(block, /compare N against 6/)
  assert.match(block, /City: Lubbock/)
  assert.match(block, /State: TX/)
  assert.match(block, /TypeScript/)
})

test("the stored figure wins over the computed one", () => {
  // years_of_experience is the parsed résumé's own number; the date math is a
  // fallback for when it is missing.
  const block = buildDerivedFacts({
    yearsOfExperience: 9,
    workExperience: [{ start_date: "Jan 2023", end_date: "Jan 2024" }],
  }, NOW)
  assert.match(block, /9 years/)
})

test("an empty profile produces no facts block rather than an empty heading", () => {
  assert.equal(buildDerivedFacts({}, NOW), "")
})
