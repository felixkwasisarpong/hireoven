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

test("blocks bare call-to-action text scraped as a title", () => {
  // Rare overall (~0.1% of listings) but they repeat while real titles are
  // diverse, so they climb into any "top roles today" ranking — which is how
  // "View job" ended up in the daily email's top 8.
  for (const title of [
    "View job",
    "apply",
    "Apply Now",
    "Apply here",
    "View Details",
    "See job",
    "Learn more",
    "Read More",
    "Details",
    "More info",
    "job",
    "Click here",
  ]) {
    assert.equal(isBlockedCrawlTitle(title), true, `should block: ${title}`)
  }
})

test("does not block real titles that contain those words", () => {
  // The healthcare abbreviations matter: CNA, EMT, LPN, RBT, LVN, PCA and CSR
  // are genuine titles on this board, and a naive length rule would erase them.
  for (const title of [
    "CNA",
    "EMT",
    "LPN",
    "RBT",
    "LVN",
    "PCA",
    "CSR",
    "Apply Engineering Manager",
    "Job Coach",
    "Details Clerk",
    "Application Developer",
    "Auto Detailer",
    "Learning Specialist",
    "Software Engineer",
  ]) {
    assert.equal(isBlockedCrawlTitle(title), false, `should allow: ${title}`)
  }
})
