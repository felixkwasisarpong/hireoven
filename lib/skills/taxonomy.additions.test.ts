import { strict as assert } from "node:assert"
import { test } from "node:test"
import { canonicalizeSkill, categorizeSkills, isKnownSkill } from "./taxonomy"

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
