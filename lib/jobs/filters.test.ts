import { strict as assert } from "node:assert"
import { test } from "node:test"
import { isBlockedApplyUrl, isBlockedCrawlTitle } from "./filters"

test("isBlockedCrawlTitle: blocks pagination/menu artifacts", () => {
  assert.equal(isBlockedCrawlTitle("Go to last page"), true)
  assert.equal(isBlockedCrawlTitle("Next page »"), true)
  assert.equal(isBlockedCrawlTitle("Page 12"), true)
  assert.equal(isBlockedCrawlTitle("View all jobs"), true)
})

test("isBlockedCrawlTitle: blocks placeholder records", () => {
  assert.equal(isBlockedCrawlTitle("Unknown Role"), true)
  assert.equal(isBlockedCrawlTitle("No job found"), true)
  assert.equal(isBlockedCrawlTitle("Open role"), true)
})

test("isBlockedCrawlTitle: keeps real job titles", () => {
  assert.equal(isBlockedCrawlTitle("Senior Backend Engineer"), false)
  assert.equal(isBlockedCrawlTitle("Expansion Account Executive"), false)
  assert.equal(isBlockedCrawlTitle("Director of Product"), false)
})

test("isBlockedApplyUrl: blocks known non-job apply URLs", () => {
  assert.equal(
    isBlockedApplyUrl("https://www.linkedin.com/jobs/software-engineer-jobs?trk=public_jobs_linkster_link"),
    true
  )
  assert.equal(
    isBlockedApplyUrl("https://careers.example.com/jobs/login?loginOnly=1"),
    true
  )
})

test("isBlockedApplyUrl: keeps real job posting URLs", () => {
  assert.equal(
    isBlockedApplyUrl("https://www.linkedin.com/jobs/view/42424242/"),
    false
  )
  assert.equal(
    isBlockedApplyUrl("https://boards.greenhouse.io/acme/jobs/123456"),
    false
  )
})
