import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extractSkills, mergeSkills } from "./skills-extractor"

test("extractSkills: finds basic programming languages", () => {
  const skills = extractSkills("Looking for a senior engineer with Python and Golang experience.")
  assert.ok(skills.includes("Python"))
  assert.ok(skills.includes("Go"), "Golang alias should map to canonical 'Go'")
})

test("extractSkills: matches aliases case-insensitively", () => {
  const skills = extractSkills("Strong knowledge of TYPESCRIPT and nodejs required.")
  assert.ok(skills.includes("TypeScript"))
  assert.ok(skills.includes("Node.js"))
})

test("extractSkills: matches multi-word skills", () => {
  const skills = extractSkills(
    "Experience with machine learning, deep learning, and natural language processing."
  )
  assert.ok(skills.includes("Machine Learning"))
  assert.ok(skills.includes("Deep Learning"))
  assert.ok(skills.includes("NLP"))
})

test("extractSkills: respects word boundaries (no substring matches)", () => {
  const skills = extractSkills(
    "We trust our team's training methodology. Available for remote details."
  )
  assert.equal(skills.includes("Rust"), false, "must not extract Rust from 'trust'")
})

test("extractSkills: avoids 'Go' false-positives from English 'go through'", () => {
  // The dictionary intentionally requires `golang`/`go-lang` aliases — not bare
  // "go" — so descriptions using plain English don't falsely surface Go.
  const skills = extractSkills("Please go through the documentation before applying.")
  assert.equal(skills.includes("Go"), false, "must not extract Go from English 'go'")
})

test("extractSkills: matches React with dot variations", () => {
  const skills = extractSkills("We use React.js for our frontend.")
  assert.ok(skills.includes("React"))
})

test("extractSkills: returns empty for null/empty input", () => {
  assert.deepEqual(extractSkills(null), [])
  assert.deepEqual(extractSkills(""), [])
  assert.deepEqual(extractSkills(undefined), [])
})

test("extractSkills: returns sorted unique results", () => {
  const skills = extractSkills(
    "Python python PYTHON. Also Python." +
      "We also use Postgres and PostgreSQL." +
      "React and React.js both."
  )
  // Python repeated should dedupe; Postgres/PostgreSQL → one canonical "PostgreSQL".
  assert.ok(skills.includes("Python"))
  assert.ok(skills.includes("PostgreSQL"))
  assert.ok(skills.includes("React"))
  // Sorted:
  assert.deepEqual([...skills].sort(), skills)
})

test("mergeSkills: unions existing + extracted case-insensitively", () => {
  const merged = mergeSkills(["typescript", "PostgreSQL"], ["TypeScript", "Python"])
  // Existing 'typescript' wins (came first), Python added from extracted.
  assert.deepEqual(merged.sort(), ["PostgreSQL", "Python", "typescript"])
})

test("mergeSkills: handles null/empty existing arrays", () => {
  assert.deepEqual(mergeSkills(null, ["Python"]), ["Python"])
  assert.deepEqual(mergeSkills([], ["Python", "Go"]), ["Go", "Python"])
})
