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
