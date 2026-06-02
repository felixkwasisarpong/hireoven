import { strict as assert } from "node:assert"
import { test } from "node:test"
import { dedupeCompanyCandidates } from "./name-normalization"

test("dedupeCompanyCandidates removes duplicate company names after normalization", () => {
  const deduped = dedupeCompanyCandidates([
    { companyNameRaw: "OpenAI, Inc.", sourceUrl: "https://example.test/a" },
    { companyNameRaw: "OpenAI", sourceUrl: "https://example.test/b" },
    { companyNameRaw: "Stripe Reviews", sourceUrl: "https://example.test/c" },
    { companyNameRaw: "Stripe, Inc.", sourceUrl: "https://example.test/d" },
  ])

  assert.deepEqual(
    deduped.map((item) => item.companyNameNormalized),
    ["openai", "stripe"]
  )
  assert.equal(deduped[0].sourceUrl, "https://example.test/a")
})
