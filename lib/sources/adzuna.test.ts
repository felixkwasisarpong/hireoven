import test from "node:test"
import assert from "node:assert/strict"
import {
  isAdzunaDescriptionLikelyTruncated,
  normalizeAdzunaCompanyLookupKey,
  normalizeAdzunaJobFingerprintPart,
} from "@/lib/sources/adzuna"

test("normalizeAdzunaCompanyLookupKey strips legal and careers suffixes", () => {
  assert.equal(normalizeAdzunaCompanyLookupKey("Microsoft Corporation"), "microsoft")
  assert.equal(normalizeAdzunaCompanyLookupKey("SPECTRUM Careers"), "spectrum")
  assert.equal(normalizeAdzunaCompanyLookupKey("The Oracle Company"), "oracle")
})

test("isAdzunaDescriptionLikelyTruncated detects API ellipsis ceiling", () => {
  const truncated = `${"x".repeat(499)}…`
  assert.equal(truncated.length, 500)
  assert.equal(isAdzunaDescriptionLikelyTruncated(truncated), true)
  assert.equal(isAdzunaDescriptionLikelyTruncated(`${"x".repeat(497)}...`), true)
})

test("isAdzunaDescriptionLikelyTruncated keeps complete descriptions", () => {
  assert.equal(isAdzunaDescriptionLikelyTruncated("short but complete."), false)
  assert.equal(isAdzunaDescriptionLikelyTruncated(`${"x".repeat(700)}.`), false)
  assert.equal(isAdzunaDescriptionLikelyTruncated(`${"x".repeat(500)}.`), false)
})

test("normalizeAdzunaJobFingerprintPart produces stable duplicate keys", () => {
  assert.equal(normalizeAdzunaJobFingerprintPart("Software / Systems Engineer - China Lake, CA"), "softwaresystemsengineerchinalakeca")
  assert.equal(normalizeAdzunaJobFingerprintPart("Ridgecrest, Kern County"), "ridgecrestkerncounty")
  assert.equal(normalizeAdzunaJobFingerprintPart(null), "")
})
