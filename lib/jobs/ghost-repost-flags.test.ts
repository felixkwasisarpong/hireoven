import assert from "node:assert/strict"
import test from "node:test"
import {
  readJobRepostCount,
  resolveGhostRepostSignals,
  FREQUENT_REPOST_THRESHOLD,
  POSSIBLE_REPOST_THRESHOLD,
  STALE_JOB_THRESHOLD_DAYS,
  VERY_STALE_JOB_THRESHOLD_DAYS,
} from "@/lib/jobs/ghost-repost-flags"

test("resolveGhostRepostSignals returns stale + repost warnings at threshold", () => {
  const result = resolveGhostRepostSignals({
    freshnessDays: STALE_JOB_THRESHOLD_DAYS + 1,
    repostCount: POSSIBLE_REPOST_THRESHOLD,
  })

  assert.equal(result.length, 2)
  assert.equal(result[0]?.kind, "stale")
  assert.equal(result[0]?.tone, "warning")
  assert.equal(result[1]?.kind, "repost")
  assert.equal(result[1]?.tone, "warning")
})

test("resolveGhostRepostSignals escalates very stale + frequent repost", () => {
  const result = resolveGhostRepostSignals({
    freshnessDays: VERY_STALE_JOB_THRESHOLD_DAYS + 7,
    repostCount: FREQUENT_REPOST_THRESHOLD + 2,
  })

  assert.equal(result.length, 2)
  assert.equal(result[0]?.tone, "critical")
  assert.equal(result[1]?.tone, "critical")
  assert.ok(result[0]?.label.includes("Very stale"))
  assert.ok(result[1]?.label.includes("Frequent repost"))
})

test("readJobRepostCount prefers joined score column over raw payload", () => {
  const result = readJobRepostCount({
    ghost_repost_count: 6,
    raw_data: { repost_count: 2 },
  })

  assert.equal(result, 6)
})

test("readJobRepostCount falls back to intelligence and raw keys", () => {
  const fromIntelligence = readJobRepostCount({
    job_intelligence: { ghostJobRisk: { repostCount: 4 } },
  })
  const fromRaw = readJobRepostCount({
    raw_data: { times_seen: "5" },
  })

  assert.equal(fromIntelligence, 4)
  assert.equal(fromRaw, 5)
})
