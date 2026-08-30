import test from "node:test"
import assert from "node:assert/strict"
import { generateFillScript } from "./index"
import type { AutofillProfile } from "@/types"

const PROFILE = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: "5555550123",
  city: "Austin",
  state: "TX",
  country: "United States",
  linkedin_url: "https://www.linkedin.com/in/example",
  years_of_experience: 6,
  salary_expectation_min: 150000,
  salary_expectation_max: 180000,
  authorized_to_work: true,
  requires_sponsorship: false,
  sponsorship_statement: "",
  auto_fill_diversity: false,
  custom_answers: [],
} as unknown as AutofillProfile

/**
 * The generated script is handed to the user to paste into a DevTools console
 * (and evaluated directly by the dry-fill harness). It shipped for a long time
 * as unparseable JavaScript — an inline onclick inside an innerHTML string
 * closed the surrounding JS string early — which silently broke the whole
 * dashboard autofill flow, because nothing ever parsed the output in a test.
 */
for (const ats of ["greenhouse", "lever", "ashby", "generic", "workday"]) {
  test(`generated script parses as valid JavaScript (${ats})`, () => {
    const { script } = generateFillScript(PROFILE, ats)
    assert.doesNotThrow(() => new Function(script), `invalid JS for ats=${ats}`)
  })
}

test("generated script parses when optional profile fields are absent", () => {
  const sparse = { first_name: "A", email: "a@example.com", custom_answers: [] } as unknown as AutofillProfile
  assert.doesNotThrow(() => new Function(generateFillScript(sparse, "greenhouse").script))
})

test("generated script parses when free-text values contain quotes and newlines", () => {
  // Profile values are interpolated as JSON, so a stray quote must not be able
  // to break out of the generated source.
  const tricky = {
    ...PROFILE,
    sponsorship_statement: `He said "I'm authorized" — line1\nline2 \\ backslash '</script>'`,
    requires_sponsorship: true,
    custom_answers: [{ question: `Why "us"?`, answer: `Because 'reasons' </script>` }],
  } as unknown as AutofillProfile
  assert.doesNotThrow(() => new Function(generateFillScript(tricky, "greenhouse").script))
})

test("the script is an expression that evaluates to a results object", () => {
  // The harness and the console flow both rely on the IIFE returning results,
  // not merely running.
  const { script } = generateFillScript(PROFILE, "greenhouse")
  assert.match(script.trim(), /^\(function/)
  assert.match(script.trim(), /\}\)\(\);?$/)
  assert.match(script, /return results;/)
})

test("estimatedFields counts only populated profile fields", () => {
  const { estimatedFields } = generateFillScript(PROFILE, "greenhouse")
  assert.ok(estimatedFields > 0)
  const { estimatedFields: none } = generateFillScript(
    { custom_answers: [] } as unknown as AutofillProfile,
    "greenhouse",
  )
  assert.equal(none, 0)
})
