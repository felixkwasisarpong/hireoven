import { strict as assert } from "node:assert"
import { test } from "node:test"
import { crawlCareersPage, isBlockedAggregatorHost } from "./index"

test("isBlockedAggregatorHost: blocks LinkedIn/Indeed/Glassdoor/ZipRecruiter and subdomains", () => {
  for (const host of [
    "linkedin.com",
    "www.linkedin.com",
    "in.linkedin.com",
    "indeed.com",
    "www.indeed.com",
    "glassdoor.com",
    "ziprecruiter.com",
  ]) {
    assert.equal(isBlockedAggregatorHost(host), true, `${host} should be blocked`)
  }
})

test("isBlockedAggregatorHost: allows real ATS/career hosts", () => {
  for (const host of [
    "boards.greenhouse.io",
    "jobs.lever.co",
    "acme.myworkdayjobs.com",
    "careers.example.com",
    "notlinkedin.com.example.org",
  ]) {
    assert.equal(isBlockedAggregatorHost(host), false, `${host} should be allowed`)
  }
})

test("crawlCareersPage: short-circuits LinkedIn careers_url without fetching", async () => {
  const result = await crawlCareersPage({
    id: "co-1",
    companyName: "The Urban Institute",
    careersUrl:
      "https://www.linkedin.com/jobs/search/?keywords=The%20Urban%20Institute",
    lastCrawledAt: null,
  })

  assert.equal(result.jobs.length, 0)
  assert.equal(result.outcomeStatus, "bad_url")
  assert.equal(result.outcomeReason, "blocked_aggregator_host")
})
