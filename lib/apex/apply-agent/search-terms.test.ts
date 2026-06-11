import assert from "node:assert/strict"
import test from "node:test"

import { extractAtsSlugs } from "@/lib/apex/apply-agent/ats"
import { extractApplyAgentSearchTerms } from "@/lib/apex/apply-agent/search-terms"

test("extractApplyAgentSearchTerms removes bulk and ATS framing", () => {
  assert.equal(
    extractApplyAgentSearchTerms("apply to top 2 jobs that uses greenhouse ATS"),
    ""
  )
})

test("extractApplyAgentSearchTerms keeps meaningful role terms", () => {
  assert.equal(
    extractApplyAgentSearchTerms("apply to 3 jobs with java skill in it"),
    "java skill"
  )
  assert.equal(
    extractApplyAgentSearchTerms("apply for 2 frontend roles at fintech companies"),
    "frontend fintech companies"
  )
})

test("extractAtsSlugs recognizes greenhouse bulk apply wording", () => {
  assert.deepEqual(
    extractAtsSlugs("apply to top 2 jobs that uses greenhouse ATS"),
    ["greenhouse"]
  )
})
