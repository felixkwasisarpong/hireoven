import { strict as assert } from "node:assert"
import { test } from "node:test"
import { parseTokenBudget } from "./parser"

// The prompt asks the model to copy every section verbatim, so output length
// tracks input length. These guard the regression that silently gutted long
// documents: a fixed 4k ceiling truncated the JSON, JSON.parse threw, and the
// heuristic fallback returned a record with no experience, education or
// publications at all.

test("a short resume keeps the original floor — no behaviour change", () => {
  assert.equal(parseTokenBudget("x".repeat(2_000)), 4_000)
  assert.equal(parseTokenBudget(""), 4_000)
})

test("a two-page resume still sits at the floor", () => {
  // ~4,500 chars is a dense two-page resume.
  assert.equal(parseTokenBudget("x".repeat(4_500)), 4_000)
})

test("a long academic CV gets a budget that can actually hold its output", () => {
  // ~45,000 chars is a fourteen-page CV with a long publication list.
  const budget = parseTokenBudget("x".repeat(45_000))
  assert.ok(budget > 4_000, "must exceed the old fixed ceiling")
  assert.ok(budget >= 20_000, `expected room for the whole document, got ${budget}`)
})

test("the budget scales with the document", () => {
  const small = parseTokenBudget("x".repeat(10_000))
  const large = parseTokenBudget("x".repeat(30_000))
  assert.ok(large > small)
})

test("the budget is capped so a pathological upload cannot request an invalid max_tokens", () => {
  assert.equal(parseTokenBudget("x".repeat(5_000_000)), 32_000)
})
