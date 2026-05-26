import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildFeedDedupeSignature, dedupeFeedJobsBySignature } from "./feed-dedupe"

test("buildFeedDedupeSignature: normalizes title/company/location", () => {
  const a = buildFeedDedupeSignature({
    company_id: "acme",
    normalized_title: "Senior Backend Engineer",
    location: "San Francisco, CA",
    is_remote: false,
  })
  const b = buildFeedDedupeSignature({
    company_id: " ACME ",
    title: "Senior Backend Engineer!!!",
    location: "san francisco ca",
    is_remote: false,
  })

  assert.equal(a, b)
})

test("buildFeedDedupeSignature: remote aliases collapse", () => {
  const a = buildFeedDedupeSignature({
    company_id: "acme",
    title: "Staff Engineer",
    location: "Remote, United States",
    is_remote: true,
  })
  const b = buildFeedDedupeSignature({
    company_id: "acme",
    title: "Staff Engineer",
    location: "Remote",
    is_remote: true,
  })

  assert.equal(a, b)
})

test("dedupeFeedJobsBySignature: keeps first row for same signature", () => {
  const rows = dedupeFeedJobsBySignature([
    { id: "1", company_id: "acme", normalized_title: "Account Executive", location: "New York, NY", is_remote: false },
    { id: "2", company_id: "acme", title: "Account Executive", location: "New York NY", is_remote: false },
    { id: "3", company_id: "acme", normalized_title: "Account Executive", location: "Remote", is_remote: true },
  ])

  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => (row as { id: string }).id), ["1", "3"])
})
