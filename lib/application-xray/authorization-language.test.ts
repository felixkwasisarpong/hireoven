import assert from "node:assert/strict"
import test from "node:test"
import {
  AUTHORIZATION_CONFLICT_MATRIX,
  AUTHORIZATION_MATRIX_COLUMNS,
  POSTING_AUTHORIZATION_CATEGORIES,
  categorizePostingAuthorizationLanguage,
} from "./authorization-language"
import type { AuthorizationConflictOutcome } from "./types"

const VALID_OUTCOMES = new Set<AuthorizationConflictOutcome>([
  "conflict_now",
  "conflict_future",
  "no_conflict",
  "needs_clarification",
  "unknown",
])

test("authorization conflict matrix covers all nine categories and five columns", () => {
  let assertionCount = 0
  assert.equal(POSTING_AUTHORIZATION_CATEGORIES.length, 9)
  assert.equal(AUTHORIZATION_MATRIX_COLUMNS.length, 5)

  for (const category of POSTING_AUTHORIZATION_CATEGORIES) {
    const row = AUTHORIZATION_CONFLICT_MATRIX[category]
    assert.deepEqual(Object.keys(row).sort(), [...AUTHORIZATION_MATRIX_COLUMNS].sort())
    for (const column of AUTHORIZATION_MATRIX_COLUMNS) {
      assert.ok(VALID_OUTCOMES.has(row[column]), `${category} x ${column}`)
      assertionCount += 1
    }
  }

  assert.equal(assertionCount, 45)
})

test("generic sponsorship timing phrases remain scope ambiguous", () => {
  for (const text of [
    "We currently do not sponsor.",
    "Sponsorship is unavailable at this time.",
    "We cannot sponsor for this role.",
    "We are unable to provide sponsorship for this position.",
    "Visa sponsorship is unavailable right now.",
    "At present, we cannot sponsor applicants.",
  ]) {
    const [requirement] = categorizePostingAuthorizationLanguage({ text })
    assert.equal(requirement?.category, "SPONSORSHIP_SCOPE_AMBIGUOUS", text)
    assert.equal(requirement?.temporalScope, "none_present", text)
  }
})

test("current-only sponsorship category requires start-employment wording", () => {
  for (const text of [
    "Applicants must be able to begin employment without sponsorship.",
    "No sponsorship is available for initial work authorization.",
  ]) {
    const [requirement] = categorizePostingAuthorizationLanguage({ text })
    assert.equal(requirement?.category, "NO_CURRENT_SPONSORSHIP", text)
    assert.ok(
      requirement?.temporalScope === "start_employment" ||
        requirement?.temporalScope === "initial_work_authorization",
      text,
    )
  }
})

test("future sponsorship wording remains explicit", () => {
  assert.equal(
    categorizePostingAuthorizationLanguage({
      text: "Future sponsorship will not be provided.",
    })[0]?.category,
    "NO_FUTURE_SPONSORSHIP",
  )
  assert.equal(
    categorizePostingAuthorizationLanguage({
      text: "Candidates who require sponsorship, now or in the future, will not be considered for this role.",
    })[0]?.category,
    "NO_CURRENT_OR_FUTURE_SPONSORSHIP",
  )
})

test("bare valid work authorization stays ambiguous general", () => {
  const [requirement] = categorizePostingAuthorizationLanguage({
    text: "You must currently possess valid U.S. work authorization.",
  })
  assert.equal(requirement?.category, "AMBIGUOUS_GENERAL")
  assert.deepEqual(requirement?.namesVisaCategories, [])
})

test("named temporary visa exclusions become unrestricted authorization requirements", () => {
  const [requirement] = categorizePostingAuthorizationLanguage({
    text: "You must currently possess valid and unrestricted U.S. work authorization. Individuals with temporary visas including F-1, OPT, CPT, STEM, H-1B or TN will not be considered.",
  })
  assert.equal(requirement?.category, "UNRESTRICTED_AUTHORIZATION_REQUIRED")
  assert.deepEqual(requirement?.namesVisaCategories, ["CPT", "F-1", "H-1B", "OPT", "STEM", "TN", "temporary visas"])
})

// ─── Sentence-level negation discriminators ─────────────────────────────────
// The offered-sponsorship phrases are substrings of their own negations, so a
// refusal was being read as an offer. These five cases are the contract.

function categoriesFor(text: string): string[] {
  return categorizePostingAuthorizationLanguage({ text }).map((r) => r.category)
}

test("'no sponsorship available' is scope-ambiguous, never an offer", () => {
  const cats = categoriesFor("This is a full time REMOTE role with no sponsorship available.")
  assert.ok(cats.includes("SPONSORSHIP_SCOPE_AMBIGUOUS"), `got ${cats.join(",")}`)
  assert.ok(!cats.includes("SPONSORSHIP_OFFERED"), "must NOT be SPONSORSHIP_OFFERED")
})

test("'sponsorship available' is an offer", () => {
  assert.deepEqual(
    categoriesFor("Visa sponsorship available for this position."),
    ["SPONSORSHIP_OFFERED"],
  )
})

test("'we cannot offer sponsorship' is scope-ambiguous, never an offer", () => {
  const cats = categoriesFor("We cannot offer sponsorship for this role.")
  assert.ok(cats.includes("SPONSORSHIP_SCOPE_AMBIGUOUS"), `got ${cats.join(",")}`)
  assert.ok(!cats.includes("SPONSORSHIP_OFFERED"), "must NOT be SPONSORSHIP_OFFERED")
})

test("'we offer sponsorship' is an offer", () => {
  assert.deepEqual(
    categoriesFor("We offer sponsorship to qualified candidates."),
    ["SPONSORSHIP_OFFERED"],
  )
})

test("advertising sponsorship yields no visa requirement", () => {
  // Verbatim shape from a live Apple posting in the corpus.
  assert.deepEqual(
    categoriesFor("Sponsorship integrations and experiences in live sports on Apple TV help advertisers connect with fans."),
    [],
  )
})

test("'sponsor a team' yields no visa requirement", () => {
  // Verbatim shape from a live Sentry posting in the corpus.
  assert.deepEqual(
    categoriesFor("Lead, mentor, coach, and sponsor a team of 4-6 engineers."),
    [],
  )
})

test("negation is scoped to its own sentence", () => {
  // A later refusal must not negate an earlier genuine offer, and vice versa.
  const cats = categoriesFor("We offer visa sponsorship. No exceptions to our interview process.")
  assert.deepEqual(cats, ["SPONSORSHIP_OFFERED"])
})

test("a citizenship requirement outranks an unrelated sponsorship mention", () => {
  const cats = categoriesFor(
    "Applicants must be U.S. citizens. We also sponsor local sports events in the community.",
  )
  assert.ok(cats.includes("CITIZENSHIP_REQUIRED"), `got ${cats.join(",")}`)
  assert.ok(!cats.includes("SPONSORSHIP_OFFERED"))
})

// ── Posting-level exclusions that employer-level checks cannot see ───────────
//
// An employer that files LCAs reads as a sponsor at the company level, so a
// posting-level bar is the only signal that disqualifies the listing. These are
// verbatim phrasings from live postings in the job index (Jack Henry &
// Associates, a Texas core-banking employer with a 91% employer sponsorship
// score, carries the first two on active engineering roles).

test("a categorical eligibility bar is a blanket refusal, not an ambiguous one", () => {
  for (const text of [
    "This position is not eligible for immigration sponsorship and support.",
    "This position is ineligible for immigration sponsorship and support.",
    "This role is ineligible for visa sponsorship.",
    "The position is not eligible for employment sponsorship.",
  ]) {
    const [requirement] = categorizePostingAuthorizationLanguage({ text })
    assert.ok(requirement, `no requirement detected for: ${text}`)
    assert.equal(
      requirement.category,
      "NO_CURRENT_OR_FUTURE_SPONSORSHIP",
      `wrong category for: ${text}`,
    )
    assert.equal(requirement.deterministicMatch, true)
    assert.ok(requirement.excerpt.length > 0, "must quote the sentence back as evidence")
  }
})

test("unrestricted right to work is caught, not just unrestricted work authorization", () => {
  for (const text of [
    "Applicants must have unrestricted right to work in the United States.",
    "Candidates must possess unrestricted authorization to work in the US.",
    "You must have unrestricted work authorization.",
  ]) {
    const [requirement] = categorizePostingAuthorizationLanguage({ text })
    assert.ok(requirement, `no requirement detected for: ${text}`)
    assert.equal(requirement.category, "UNRESTRICTED_AUTHORIZATION_REQUIRED", `wrong category for: ${text}`)
  }
})

test("plain work-authorization language is NOT treated as an exclusion", () => {
  // An OPT holder IS authorized to work. Reading this as a bar would hide every
  // sponsoring employer that states the ordinary I-9 requirement — the same
  // inversion in the opposite direction.
  for (const text of [
    "Candidates must be authorized to work in the US.",
    "All applicants must be legally authorized to work in the United States.",
  ]) {
    const [requirement] = categorizePostingAuthorizationLanguage({ text })
    assert.notEqual(requirement?.category, "NO_CURRENT_OR_FUTURE_SPONSORSHIP")
    assert.notEqual(requirement?.category, "UNRESTRICTED_AUTHORIZATION_REQUIRED")
  }
})

test("an eligibility bar stated positively is not flipped into a refusal", () => {
  const [requirement] = categorizePostingAuthorizationLanguage({
    text: "Candidates on F-1 OPT are eligible for immigration sponsorship at this company.",
  })
  assert.notEqual(requirement?.category, "NO_CURRENT_OR_FUTURE_SPONSORSHIP")
})

test("the new patterns do not fire on the non-immigration sense of sponsor", () => {
  for (const text of [
    "You will mentor, coach, and sponsor a team of 4-6 engineers.",
    "Own sponsorship integrations and advertiser relationships.",
  ]) {
    assert.deepEqual(categorizePostingAuthorizationLanguage({ text }), [])
  }
})
