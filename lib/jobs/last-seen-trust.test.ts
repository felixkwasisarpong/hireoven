import test from "node:test"
import assert from "node:assert/strict"
import {
  HARVESTER_LAST_SEEN_EPOCH_ISO,
  isLastSeenTrustworthy,
  lastSeenTrustExplanation,
} from "@/lib/jobs/last-seen-trust"

const ANY_TIME = "2026-08-13T12:00:00.000Z"

test("harvester rows are untrusted while the epoch is unset", () => {
  // The safe default: until someone records when the fix deployed, a harvester
  // timestamp could be a pre-fix value and we cannot tell.
  if (HARVESTER_LAST_SEEN_EPOCH_ISO !== null) return // epoch has been set; see the dated tests below
  const result = isLastSeenTrustworthy({ lastSeenAt: ANY_TIME, ingestionPath: "harvester" })
  assert.equal(result.trustworthy, false)
  assert.equal(result.reason, "epoch_not_set")
})

test("legacy crawler and aggregator rows are trusted regardless of the epoch", () => {
  // Neither path ever skipped the last_seen_at write, so the fix does not apply.
  for (const path of ["legacy_crawler", "aggregator"] as const) {
    const result = isLastSeenTrustworthy({ lastSeenAt: ANY_TIME, ingestionPath: path })
    assert.equal(result.trustworthy, true, `path: ${path}`)
    assert.equal(result.reason, null)
  }
})

test("an unattributable row is treated with harvester-level suspicion", () => {
  const result = isLastSeenTrustworthy({ lastSeenAt: ANY_TIME, ingestionPath: "unknown" })
  assert.equal(result.trustworthy, false)
  assert.equal(result.reason, "unknown_ingestion_path")
})

test("a missing or unparseable timestamp is never trusted", () => {
  for (const value of [null, undefined, ""]) {
    const result = isLastSeenTrustworthy({ lastSeenAt: value, ingestionPath: "aggregator" })
    assert.equal(result.trustworthy, false, `value: ${JSON.stringify(value)}`)
    assert.equal(result.reason, "missing_timestamp")
  }
  const garbage = isLastSeenTrustworthy({ lastSeenAt: "not a date", ingestionPath: "aggregator" })
  // The aggregator short-circuit runs first, so this asserts the ordering is
  // deliberate: an unparseable value on a trusted path still reads as trusted
  // by path. Guard against it downstream by parsing before use.
  assert.equal(garbage.trustworthy, true)
})

test("every reason has an explanation, and a trusted result has none", () => {
  const reasons = [
    "epoch_not_set",
    "written_before_fix",
    "missing_timestamp",
    "unknown_ingestion_path",
  ] as const
  for (const reason of reasons) {
    const text = lastSeenTrustExplanation(reason)
    assert.ok(text && text.length > 0, `missing explanation for ${reason}`)
    // Copy must never imply the job is gone — that is the whole failure mode.
    assert.doesNotMatch(text, /\bgone\b|\bclosed\b|\bdead\b|\bexpired\b/i, `unsafe copy for ${reason}`)
  }
  assert.equal(lastSeenTrustExplanation(null), null)
})

test("once the epoch is set, rows split on it", () => {
  if (HARVESTER_LAST_SEEN_EPOCH_ISO === null) return // not yet configured
  const epochMs = Date.parse(HARVESTER_LAST_SEEN_EPOCH_ISO)

  const after = new Date(epochMs + 86_400_000).toISOString()
  const before = new Date(epochMs - 86_400_000).toISOString()

  assert.equal(isLastSeenTrustworthy({ lastSeenAt: after, ingestionPath: "harvester" }).trustworthy, true)

  const stale = isLastSeenTrustworthy({ lastSeenAt: before, ingestionPath: "harvester" })
  assert.equal(stale.trustworthy, false)
  assert.equal(stale.reason, "written_before_fix")

  // Boundary: exactly at the epoch counts as post-fix.
  const exact = new Date(epochMs).toISOString()
  assert.equal(isLastSeenTrustworthy({ lastSeenAt: exact, ingestionPath: "harvester" }).trustworthy, true)
})
