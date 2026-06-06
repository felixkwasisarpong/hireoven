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

test("normalizeAtsUrl canonicalizes Greenhouse board embed scripts with for token", () => {
  const result = normalizeAtsUrl(
    "https://boards.greenhouse.io/embed/job_board/js?for=quinstreet"
  )
  assert.equal(result.provider, "greenhouse")
  assert.equal(result.shouldPersist, true)
  assert.equal(result.normalizedUrl, "https://boards.greenhouse.io/quinstreet")
  assert.equal(result.atsIdentifier, "quinstreet")
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

test("normalizeAtsUrl persists clean jobvite company URL", () => {
  const result = normalizeAtsUrl("https://jobs.jobvite.com/example/job/o123?__jvst=CareerSite")
  assert.equal(result.provider, "jobvite")
  assert.equal(result.shouldPersist, true)
  assert.equal(result.normalizedUrl, "https://jobs.jobvite.com/example/jobs")
  assert.equal(result.atsIdentifier, "example")
})

test("normalizeAtsUrl persists branded iCIMS portals when ats_type hint provided", () => {
  const result = normalizeAtsUrl("https://careers.acme.com/jobs", {
    atsType: "icims",
  })
  assert.equal(result.provider, "icims")
  assert.equal(result.shouldPersist, true)
})

test("normalizeAtsUrl canonicalizes iCIMS job evidence to the search page", () => {
  const result = normalizeAtsUrl("https://careers-acme.icims.com/jobs/scripts/ats.js")
  assert.equal(result.provider, "icims")
  assert.equal(result.normalizedUrl, "https://careers-acme.icims.com/jobs/search")
  assert.equal(result.shouldPersist, true)
})

test("normalizeAtsUrl persists enterprise ATS URLs", () => {
  assert.equal(
    normalizeAtsUrl("https://apply.workable.com/acme/jobs/123").normalizedUrl,
    "https://apply.workable.com/acme/"
  )
  assert.equal(
    normalizeAtsUrl("https://acme.recruitee.com/o/software-engineer").normalizedUrl,
    "https://acme.recruitee.com/"
  )
  assert.equal(
    normalizeAtsUrl("https://acme.jobs.phenompeople.com/us/en").provider,
    "phenom"
  )
  assert.equal(
    normalizeAtsUrl("https://acme.eightfold.ai/careers").provider,
    "eightfold"
  )
  assert.equal(
    normalizeAtsUrl("https://acme.avature.net/careers").provider,
    "avature"
  )
  assert.equal(
    normalizeAtsUrl("https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html").provider,
    "adp"
  )
  assert.equal(
    normalizeAtsUrl("https://recruiting.ultipro.com/ACM1000/jobboard").provider,
    "ukg"
  )
})

test("normalizeAtsUrl rejects Phenom CDN assets as stable candidates", () => {
  const result = normalizeAtsUrl(
    "https://cdn.phenompeople.com/CareerConnectResources/MCAFGLOBAL/en_global/desktop/assets/images/l/apple-touch-icon-precomposed.png?v=1"
  )
  assert.equal(result.provider, "phenom")
  assert.equal(result.shouldPersist, false)
})
