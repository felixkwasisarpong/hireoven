import { strict as assert } from "node:assert"
import { test } from "node:test"
import { leverAdapter } from "./lever"

test("lever: detectFromUrl resolves a jobs.lever.co URL", () => {
  assert.deepEqual(leverAdapter.detectFromUrl("https://jobs.lever.co/anduril"), { slug: "anduril" })
})

test("lever: detectFromUrl ignores trailing path segments", () => {
  assert.deepEqual(
    leverAdapter.detectFromUrl("https://jobs.lever.co/anduril/some-role-id"),
    { slug: "anduril" }
  )
})

test("lever: detectFromUrl returns null for non-Lever hosts", () => {
  assert.equal(leverAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

test("lever: detectFromUrl returns null when slug is missing or malformed", () => {
  assert.equal(leverAdapter.detectFromUrl("https://jobs.lever.co/"), null)
  assert.equal(leverAdapter.detectFromUrl("https://jobs.lever.co/!!"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_LEVER_SLUG ?? "anduril"
const LIVE_LATENCY_BUDGET_MS = Number.parseInt(
  process.env.HARVESTER_LIVE_LATENCY_BUDGET_MS ?? "5000",
  10
)

test(
  "lever: live fetch returns a shaped response within latency budget",
  { skip: !LIVE },
  async () => {
    const startedAt = Date.now()
    let result
    try {
      result = await leverAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      const status = (error as { status?: number | null }).status
      if (status === 404) {
        // Company is no longer on Lever — skip rather than fail.
        return
      }
      throw error
    }
    const elapsed = Date.now() - startedAt

    assert.equal(result.sourceAts, "lever")
    assert.equal(result.sourceAtsSlug, LIVE_SLUG)
    assert.equal(result.notModified, false)
    assert.ok(Array.isArray(result.jobs))
    assert.ok(
      elapsed < LIVE_LATENCY_BUDGET_MS,
      `fetch took ${elapsed}ms, budget ${LIVE_LATENCY_BUDGET_MS}ms`
    )

    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^lever:.+/)
      assert.ok(sample.title.length > 0)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
