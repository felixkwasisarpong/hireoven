import assert from "node:assert/strict"
import { test } from "node:test"
import {
  normalizeJobTitle,
  titlePhrases,
  bareSocCode,
  isSpecialtyOccupation,
  socMajorGroup,
} from "./soc-classifier"

test("seniority and level noise is stripped so variants collapse to one lexicon key", () => {
  const target = "software engineer"
  for (const title of [
    "Software Engineer",
    "Sr. Software Engineer",
    "Senior Software Engineer III",
    "Staff Software Engineer",
    "software engineer II",
    "Lead Software Engineer",
  ]) {
    assert.equal(normalizeJobTitle(title), target, `"${title}" should normalize to "${target}"`)
  }
})

test("digits are dropped as whole tokens only, so '3d artist' keeps its 3d", () => {
  assert.equal(normalizeJobTitle("3D Artist"), "3d artist")
  assert.equal(normalizeJobTitle("Engineer 2"), "engineer")
})

test("accents are folded", () => {
  assert.equal(normalizeJobTitle("Ingénieur Développeur"), "ingenieur developpeur")
})

test("a title that is nothing but noise normalizes to empty and yields no phrases", () => {
  assert.equal(normalizeJobTitle("Senior III"), "")
  assert.deepEqual(titlePhrases(""), [])
})

test("phrases are emitted longest-first so the most specific match wins", () => {
  const phrases = titlePhrases("machine learning engineer autonomy")
  assert.equal(phrases[0], "machine learning engineer autonomy")
  // "machine learning engineer" must be offered before the shorter "machine learning".
  assert.ok(
    phrases.indexOf("machine learning engineer") < phrases.indexOf("machine learning"),
    "longer phrase must be tried first"
  )
})

test("single-token titles produce no phrases — 'engineer' alone is too ambiguous to classify", () => {
  assert.deepEqual(titlePhrases("engineer"), [])
})

test("phrases are de-duplicated", () => {
  const phrases = titlePhrases("engineer engineer engineer")
  assert.equal(new Set(phrases).size, phrases.length)
})

// This is the join that silently matches nothing if it regresses: filing data uses the O*NET
// suffix ('15-1252.00'), the published wage tables use the bare code ('15-1252').
test("bareSocCode strips the O*NET suffix used in LCA filing data", () => {
  assert.equal(bareSocCode("15-1252.00"), "15-1252")
  assert.equal(bareSocCode("15-1252"), "15-1252")
  assert.equal(bareSocCode(" 17-2141.00 "), "17-2141")
  assert.equal(bareSocCode(""), null)
  assert.equal(bareSocCode(null), null)
  assert.equal(bareSocCode("not-a-soc"), null)
})

test("specialty-occupation gate keeps the lottery card off non-sponsorable work", () => {
  assert.equal(socMajorGroup("15-1252"), "15")
  // Computer, engineering, healthcare practitioners: plausible H-1B specialty occupations.
  for (const soc of ["15-1252", "17-2141", "29-1141", "13-2011", "11-3021"]) {
    assert.equal(isSpecialtyOccupation(soc), true, `${soc} should be a specialty occupation`)
  }
  // Food prep, sales, office support, transport: not.
  for (const soc of ["35-3023", "41-2011", "43-4051", "53-3032"]) {
    assert.equal(isSpecialtyOccupation(soc), false, `${soc} should NOT be a specialty occupation`)
  }
  assert.equal(isSpecialtyOccupation(null), false)
})
