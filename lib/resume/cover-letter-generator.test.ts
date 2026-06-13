import test from "node:test"
import assert from "node:assert/strict"
import { bodySimilarity } from "@/lib/resume/cover-letter-generator"

const BASE =
  "I have spent the last five years building payments infrastructure at scale. " +
  "At Stripe I led the team that cut settlement latency by forty percent, and I " +
  "want to bring that same rigor to your platform team."

test("bodySimilarity: identical text scores 1", () => {
  assert.equal(bodySimilarity(BASE, BASE), 1)
})

// The content-dedup on "Save as new version" only blocks output that is
// essentially identical to an existing version (the LLM literally returning the
// same letter — see the whitespace/case test below, which normalizes to 1).
// Any real word change is kept, because the user explicitly chose to save a new
// version. Regenerate clutter is handled separately by replace-by-default.
test("bodySimilarity: an intentionally-edited version is kept (< 0.9)", () => {
  const edited = BASE.replace("rigor", "discipline").replace("bring that same", "apply that")
  assert.ok(bodySimilarity(BASE, edited) < 0.9, "a real edit should not be deduped")
})

test("bodySimilarity: a genuinely different letter scores well below threshold", () => {
  const different =
    "My background is in clinical research operations. I coordinated three " +
    "multi-site oncology trials and managed regulatory submissions across the EU."
  assert.ok(bodySimilarity(BASE, different) < 0.2, "different letter should not be deduped")
})

test("bodySimilarity: insensitive to whitespace and punctuation", () => {
  const noisy = `  ${BASE.replace(/\./g, " . ").toUpperCase()}  `
  assert.equal(bodySimilarity(BASE, noisy), 1)
})

test("bodySimilarity: no divide-by-zero on empty input", () => {
  assert.equal(bodySimilarity("", ""), 1)
  assert.equal(bodySimilarity(BASE, ""), 0)
})
