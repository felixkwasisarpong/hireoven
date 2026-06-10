import assert from "node:assert/strict"
import test from "node:test"

import {
  extractOpportunityRerankTarget,
  isOpportunityRerankMessage,
} from "./opportunity-rerank"

test("detects generated opportunity re-rank suggestions", () => {
  const message = "Re-rank my opportunities around Backend Engineering and tell me what deserves attention today"

  assert.equal(isOpportunityRerankMessage(message), true)
  assert.deepEqual(extractOpportunityRerankTarget(message), {
    label: "Backend Engineering",
    query: "backend",
  })
})

test("detects attention-today prompts without forcing a keyword filter", () => {
  assert.deepEqual(
    extractOpportunityRerankTarget("Tell me what deserves attention today"),
    { label: "your strongest matches" }
  )
})

test("ignores general Apex questions", () => {
  assert.equal(isOpportunityRerankMessage("What skills are missing from my profile?"), false)
  assert.equal(extractOpportunityRerankTarget("What skills are missing from my profile?"), null)
})
