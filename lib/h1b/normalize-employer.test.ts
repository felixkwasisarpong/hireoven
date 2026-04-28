import test from "node:test"
import assert from "node:assert/strict"
import { normalizeEmployerName } from "@/lib/h1b/normalize-employer"

test("normalizeEmployerName normalizes common legal suffix variants consistently", () => {
  const variants = [
    "Google LLC",
    "GOOGLE, LLC",
    "Google Inc.",
    "Google Incorporated",
  ]

  const normalized = variants.map(normalizeEmployerName)
  assert.ok(normalized.every((value) => value === normalized[0]))
  assert.equal(normalized[0], "google")
})

test("normalizeEmployerName strips punctuation and noisy legal tokens", () => {
  const value = normalizeEmployerName("Acme Technologies, Corp.")
  assert.equal(value, "acme")
})

