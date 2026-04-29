import test from "node:test"
import assert from "node:assert/strict"
import { normalizeAtsUrl } from "@/lib/companies/ats-url-normalization"

test("normalizeAtsUrl rejects URLs with validityToken / share params", () => {
  const result = normalizeAtsUrl(
    "https://boards.greenhouse.io/example/jobs/123?validityToken=abc&share=1"
  )
  assert.equal(result.shouldPersist, false)
  assert.equal(result.reason, "temporary_or_share_url")
})

test("normalizeAtsUrl rejects greenhouse /embed URLs", () => {
  const result = normalizeAtsUrl(
    "https://boards.greenhouse.io/embed/job_app?token=xyz"
  )
  assert.equal(result.shouldPersist, false)
  assert.equal(result.reason, "temporary_or_share_url")
})

test("normalizeAtsUrl persists clean lever company URL", () => {
  const result = normalizeAtsUrl("https://jobs.lever.co/example/abc123")
  assert.equal(result.provider, "lever")
  assert.equal(result.shouldPersist, true)
  assert.equal(result.normalizedUrl, "https://jobs.lever.co/example")
  assert.equal(result.atsIdentifier, "example")
})

test("normalizeAtsUrl persists clean ashby company URL", () => {
  const result = normalizeAtsUrl("https://jobs.ashbyhq.com/example/role-id")
  assert.equal(result.provider, "ashby")
  assert.equal(result.shouldPersist, true)
  assert.equal(result.normalizedUrl, "https://jobs.ashbyhq.com/example")
})

test("normalizeAtsUrl persists branded iCIMS portals when ats_type hint provided", () => {
  const result = normalizeAtsUrl("https://careers.acme.com/jobs", {
    atsType: "icims",
  })
  assert.equal(result.provider, "icims")
  assert.equal(result.shouldPersist, true)
})
