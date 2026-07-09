import test from "node:test"
import assert from "node:assert/strict"
import { normalizePostedAtToIso } from "@/lib/crawler/persist"

const crawledAt = new Date("2026-07-09T12:00:00.000Z")

test("clamps a FUTURE posted date back to crawl time (custom-scraper deadline bug)", () => {
  // A custom scraper handed us a future date (e.g. an application deadline
  // mislabeled as the posting date). It must NOT become first_detected_at.
  const result = normalizePostedAtToIso("2026-10-25", crawledAt)
  assert.equal(result, crawledAt.toISOString())
})

test("keeps a normal PAST posted date as-is", () => {
  const result = normalizePostedAtToIso("2026-07-01T09:00:00.000Z", crawledAt)
  assert.equal(result, "2026-07-01T09:00:00.000Z")
})

test("relative 'N days ago' stays in the past", () => {
  const result = normalizePostedAtToIso("3 days ago", crawledAt)
  assert.equal(result, new Date("2026-07-06T12:00:00.000Z").toISOString())
})

test("'today' / 'just posted' map to crawl time (not the future)", () => {
  assert.equal(normalizePostedAtToIso("today", crawledAt), crawledAt.toISOString())
  assert.equal(normalizePostedAtToIso("Posted Just posted", crawledAt), crawledAt.toISOString())
})

test("empty / unparseable input returns null", () => {
  assert.equal(normalizePostedAtToIso(undefined, crawledAt), null)
  assert.equal(normalizePostedAtToIso("   ", crawledAt), null)
  assert.equal(normalizePostedAtToIso("whenever", crawledAt), null)
})
