import test from "node:test"
import assert from "node:assert/strict"
import { classifyApplyMethod, isAutoApplyable } from "./apply-method"

test("real tier-1 apply URLs are fillable", () => {
  for (const url of [
    "https://job-boards.greenhouse.io/acme/jobs/4123456",
    "https://boards.greenhouse.io/acme/jobs/1",
    "https://jobs.lever.co/acme/2b1f-abc",
    "https://jobs.ashbyhq.com/acme/9d0",
    "https://apply.workable.com/acme/j/ABC123/",
    "https://acme.applytojob.com/apply/xyz",
    "https://acme.breezy.hr/p/abc-engineer",
    "https://acme.bamboohr.com/careers/42",
    "https://jobs.smartrecruiters.com/Acme/744000",
    "https://acme.recruitee.com/o/engineer",
  ]) {
    assert.equal(classifyApplyMethod(url), "tier1_fillable", url)
  }
})

test("account-gated ATS are tier 2", () => {
  for (const url of [
    "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/Engineer_R-1",
    "https://cvshealth.wd1.myworkdayjobs.com/en-US/x/job/y",
    "https://efaa.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/job/123",
    "https://careers-commonspirit.icims.com/jobs/1234/login",
    "https://acme.taleo.net/careersection/x/jobdetail.ftl",
  ]) {
    assert.equal(classifyApplyMethod(url), "tier2_account", url)
  }
})

test("aggregator links are not application forms", () => {
  // Dice alone is ~17% of the fresh feed and yields zero applyable inventory.
  for (const url of [
    "https://www.dice.com/job-detail/abc-123",
    "https://www.adzuna.com/details/1234567",
    "https://www.adzuna.ca/details/999",
    "https://jooble.org/jdp/123",
    "https://www.arbeitnow.com/view/engineer-123",
    "https://builtin.com/job/engineer/123",
  ]) {
    assert.equal(classifyApplyMethod(url), "aggregator_redirect", url)
  }
})

test("LinkedIn and Indeed are denylisted, never merely unknown", () => {
  assert.equal(classifyApplyMethod("https://www.linkedin.com/jobs/view/123"), "denylisted")
  assert.equal(classifyApplyMethod("https://www.indeed.com/viewjob?jk=abc"), "denylisted")
})

test("an aggregator link mentioning an ATS in its query string stays an aggregator", () => {
  // Matching on a substring of the whole URL rather than the parsed host would
  // classify this as fillable and send a worker to a Dice listing page.
  assert.equal(
    classifyApplyMethod("https://www.dice.com/job-detail/1?redirect=https%3A%2F%2Fboards.greenhouse.io%2Facme"),
    "aggregator_redirect",
  )
})

test("a subdomain of a denylisted host is still denylisted", () => {
  assert.equal(classifyApplyMethod("https://uk.linkedin.com/jobs/view/9"), "denylisted")
})

test("the apply URL wins over a stale company ats_type tag", () => {
  // A company tagged greenhouse whose posting links to Dice is a Dice link.
  assert.equal(
    classifyApplyMethod("https://www.dice.com/job-detail/abc", "greenhouse"),
    "aggregator_redirect",
  )
})

test("vanity-domain Workday falls back to the ats_type tag", () => {
  assert.equal(
    classifyApplyMethod("https://careers.acme.com/job/123", "workday"),
    "tier2_account",
  )
})

test("a fillable ats_type tag never upgrades an unconfirmed host to tier 1", () => {
  // Claiming a form is fillable when the URL doesn't confirm it burns a worker
  // slot and shows up as a failure; let a live probe decide instead.
  assert.equal(
    classifyApplyMethod("https://careers.acme.com/job/123", "greenhouse"),
    "unknown",
  )
})

test("missing or malformed apply URLs are unknown, not applyable", () => {
  for (const url of [null, undefined, "", "   ", "not a url", "javascript:void(0)"]) {
    assert.equal(classifyApplyMethod(url as string | null), "unknown", String(url))
  }
})

test("isAutoApplyable admits only tier 1", () => {
  assert.equal(isAutoApplyable("https://jobs.lever.co/acme/1"), true)
  assert.equal(isAutoApplyable("https://acme.wd1.myworkdayjobs.com/x"), false)
  assert.equal(isAutoApplyable("https://www.dice.com/job-detail/1"), false)
  assert.equal(isAutoApplyable(null), false)
})
