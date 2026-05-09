import test from "node:test"
import assert from "node:assert/strict"
import { getApplyCtaLabel, isKnownAtsApplyUrl } from "@/lib/jobs/apply-cta"

test("isKnownAtsApplyUrl detects common ATS hosts", () => {
  assert.equal(isKnownAtsApplyUrl("https://boards.greenhouse.io/acme/jobs/123"), true)
  assert.equal(isKnownAtsApplyUrl("https://jobs.lever.co/acme/xyz"), true)
  assert.equal(isKnownAtsApplyUrl("https://jobs.jobvite.com/acme/job/oXyz"), true)
  assert.equal(isKnownAtsApplyUrl("https://grnh.se/abc123"), true)
})

test("isKnownAtsApplyUrl rejects non-ATS links", () => {
  assert.equal(isKnownAtsApplyUrl("https://careers.example.com/open-roles/software-engineer"), false)
  assert.equal(isKnownAtsApplyUrl("https://www.example.com/jobs/backend-engineer"), false)
  assert.equal(isKnownAtsApplyUrl(null), false)
})

test("getApplyCtaLabel returns quick apply only for ATS links", () => {
  assert.equal(getApplyCtaLabel("https://jobs.ashbyhq.com/acme/123"), "Quick Apply")
  assert.equal(getApplyCtaLabel("https://company.example.com/careers/123"), "Apply")
})
