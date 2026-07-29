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

test("extractSkills: covers newly-added tooling/testing/BI/cert skills", () => {
  const skills = extractSkills(
    "Built E2E tests in Cypress and Selenium; dashboards in Tableau and Power BI. " +
      "Pipelines with Apache Airflow and dbt. Tracked work in Jira. CFA charterholder. " +
      "Mobile apps in React Native and Flutter using Tailwind CSS."
  )
  for (const expected of [
    "Cypress",
    "Selenium",
    "Tableau",
    "Power BI",
    "Apache Airflow",
    "dbt",
    "Jira",
    "CFA",
    "React Native",
    "Flutter",
    "Tailwind CSS",
  ]) {
    assert.ok(skills.includes(expected), `expected to extract ${expected}`)
  }
})

test("extractSkills: new ambiguous-ish aliases stay word-bounded", () => {
  // "bootstrap" as a business verb must NOT surface the Bootstrap framework
  // (only "bootstrap css" / "twitter bootstrap" aliases are registered).
  const skills = extractSkills("We bootstrapped the company and value a can-do attitude.")
  assert.equal(skills.includes("Bootstrap"), false)
})

test("extractSkills: recognizes the 'C' programming language when disambiguated", () => {
  // Real bug: a job requiring "6 years of experience with 'C' Programming"
  // (quoted, the PRIMARY required language) never surfaced "C" as a skill —
  // there was no dictionary entry for bare "C" at all — so a resume missing
  // it still scored as a near-perfect language match.
  const quoted = extractSkills("At least 6 years of experience with 'C' Programming.")
  assert.ok(quoted.includes("C"), "quoted 'C' Programming must extract as C")

  const plain = extractSkills("Strong C programming and C++ skills required.")
  assert.ok(plain.includes("C"))
  assert.ok(plain.includes("C++"))

  const slash = extractSkills("Proficient in C/C++ for embedded systems.")
  assert.ok(slash.includes("C"))
  assert.ok(slash.includes("C++"))

  const ansi = extractSkills("Experience writing ANSI C for firmware.")
  assert.ok(ansi.includes("C"))
})

test("extractSkills: 'C' requires disambiguation — no false positives from common English", () => {
  const skills = extractSkills(
    "Grade C students can still apply. Vitamin C is not required. See section C for details."
  )
  assert.equal(skills.includes("C"), false, "bare 'C' without a language disambiguator must not match")
})

test("extractSkills: C++/C#/.NET match in ordinary prose, not just glued to a following word char", () => {
  // Real bug: the default `\b<alias>\b` wrapping put a boundary directly
  // after "+"/"#" (C++, C#) or directly before "." (.NET) — a non-word char
  // next to another non-word char (a following space or trailing period)
  // is NOT a `\b` transition, so these never matched ordinary phrasing like
  // "C++ skills" or "with .NET framework", only the rare case of being
  // glued straight to a word char (e.g. "C++11").
  assert.ok(extractSkills("Strong C++ skills required.").includes("C++"), "C++ followed by a space")
  assert.ok(extractSkills("5 years of C++.").includes("C++"), "C++ followed by a period")
  assert.ok(extractSkills("Experience with C# and ASP.NET.").includes("C#"), "C# followed by a space")
  assert.ok(extractSkills("Looking for a C# developer.").includes("C#"), "C# followed by a space, different sentence")
  assert.ok(extractSkills("Built services with .NET Core.").includes(".NET"), ".NET preceded by a space")
  assert.ok(extractSkills("5+ years of .NET.").includes(".NET"), ".NET preceded by a space, followed by a period")
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
