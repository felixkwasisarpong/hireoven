import { strict as assert } from "node:assert"
import { test } from "node:test"
import { canonicalizeSkill, categorizeSkills, extractSkillsFromText, isKnownSkill } from "./taxonomy"

// These mirror the skills-dictionary.ts additions so the skill-gap recommender
// (which gates on isKnownSkill) will surface them as gaps, not silently drop them.
const NEW_SKILLS = [
  "Metabase",
  "Hadoop",
  "Bitbucket",
  "Argo CD",
  "Bootstrap",
  "jQuery",
  "InVision",
  "Burp Suite",
  "Nmap",
  "CISSP",
  "CompTIA",
  "CFA",
  "Certified ScrumMaster",
]

test("taxonomy recognizes every mirrored skill (skill-gap can surface them)", () => {
  for (const skill of NEW_SKILLS) {
    assert.ok(isKnownSkill(skill), `isKnownSkill should be true for ${skill}`)
  }
})

test("aliases canonicalize to the shared label used on jobs", () => {
  assert.equal(canonicalizeSkill("jquery"), "jQuery")
  assert.equal(canonicalizeSkill("burp suite"), "Burp Suite")
  assert.equal(canonicalizeSkill("chartered financial analyst"), "CFA")
  assert.equal(canonicalizeSkill("argocd"), "Argo CD")
})

test("new tech skills categorize into the correct buckets", () => {
  const c = categorizeSkills(["Bootstrap", "Bitbucket", "Hadoop", "Nmap", "InVision"])
  assert.ok(c.frameworks.includes("Bootstrap"))
  assert.ok(c.devops.includes("Bitbucket"))
  assert.ok(c.data.includes("Hadoop"))
  assert.ok(c.security.includes("Nmap"))
  assert.ok(c.media.includes("InVision"))
})

test("extractSkillsFromText recognizes 'C' when disambiguated, mirroring the skills-dictionary.ts fix", () => {
  // Real bug: a job requiring "6 years of experience with 'C' Programming"
  // (quoted, the PRIMARY required language) never surfaced "C" as a required
  // skill — there was no taxonomy entry for bare "C" at all — so a match
  // score computed against a resume missing it never penalized the gap.
  const hpeJobPhrase = extractSkillsFromText(
    "At least 6 years of experience with 'C' Programming. " +
      "At least 2 years of experience with 'C++' Programming. " +
      "Hands on experience in Linux and Python"
  )
  assert.ok(hpeJobPhrase.includes("C"), "quoted 'C' Programming must extract as C")
  assert.ok(hpeJobPhrase.includes("C++"))
  assert.ok(hpeJobPhrase.includes("Python"))
  assert.ok(hpeJobPhrase.includes("Linux"))

  assert.ok(extractSkillsFromText("Strong C programming and C++ skills required.").includes("C"))
  assert.ok(extractSkillsFromText("Proficient in C/C++ for embedded systems.").includes("C"))
  assert.ok(extractSkillsFromText("Experience writing ANSI C for firmware.").includes("C"))
})

test("extractSkillsFromText: 'C' requires disambiguation — no false positives from common English", () => {
  const skills = extractSkillsFromText(
    "Grade C students can still apply. Vitamin C is not required. See section C for details."
  )
  assert.equal(skills.includes("C"), false, "bare 'C' without a language disambiguator must not match")
})
