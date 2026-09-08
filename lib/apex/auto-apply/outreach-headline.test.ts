import test from "node:test"
import assert from "node:assert/strict"
import { trimToSentence } from "./post-submit-outreach"

test("keeps a summary that already fits", () => {
  assert.equal(trimToSentence("Backend engineer.", 200), "Backend engineer.")
})

test("cuts at a sentence boundary rather than mid-clause", () => {
  // The real regression: a raw slice produced "...per day at approximately."
  const summary =
    "Backend engineer with six years in payments. Owned a platform sustaining over 1 million transactions per day at approximately 99.99% availability across three regions."
  const out = trimToSentence(summary, 60)
  assert.equal(out, "Backend engineer with six years in payments.")
  assert.ok(!out.endsWith("at approximately"))
})

test("falls back to a whole word when there is no sentence break", () => {
  const out = trimToSentence("alpha beta gamma delta epsilon", 14)
  assert.equal(out, "alpha beta")
})

test("collapses whitespace and handles an empty summary", () => {
  assert.equal(trimToSentence("  a   b  ", 200), "a b")
  assert.equal(trimToSentence("   ", 200), "")
})
