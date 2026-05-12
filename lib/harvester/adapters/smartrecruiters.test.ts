import { strict as assert } from "node:assert"
import { test } from "node:test"
import { smartrecruitersAdapter } from "./smartrecruiters"

test("smartrecruiters: detectFromUrl resolves a jobs.smartrecruiters.com URL", () => {
  assert.deepEqual(
    smartrecruitersAdapter.detectFromUrl("https://jobs.smartrecruiters.com/Bosch"),
    { slug: "Bosch" }
  )
})

test("smartrecruiters: detectFromUrl strips trailing path segments", () => {
  assert.deepEqual(
    smartrecruitersAdapter.detectFromUrl("https://jobs.smartrecruiters.com/Bosch/123456-some-role"),
    { slug: "Bosch" }
  )
})

test("smartrecruiters: detectFromUrl returns null for non-SR hosts", () => {
  assert.equal(smartrecruitersAdapter.detectFromUrl("https://jobs.lever.co/anduril"), null)
})

test("smartrecruiters: detectFromUrl returns null for empty or invalid slug", () => {
  assert.equal(smartrecruitersAdapter.detectFromUrl("https://jobs.smartrecruiters.com/"), null)
  assert.equal(smartrecruitersAdapter.detectFromUrl("https://jobs.smartrecruiters.com/$$$"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_SMARTRECRUITERS_SLUG ?? "Bosch"
const LIVE_LATENCY_BUDGET_MS = Number.parseInt(
  process.env.HARVESTER_LIVE_LATENCY_BUDGET_MS ?? "10000",
  10
)

test(
  "smartrecruiters: live fetch returns a shaped response within latency budget",
  { skip: !LIVE },
  async () => {
    const startedAt = Date.now()
    let result
    try {
      result = await smartrecruitersAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      const status = (error as { status?: number | null }).status
      if (status === 404) return
      throw error
    }
    const elapsed = Date.now() - startedAt

    assert.equal(result.sourceAts, "smartrecruiters")
    assert.equal(result.sourceAtsSlug, LIVE_SLUG)
    assert.equal(result.notModified, false)
    assert.ok(Array.isArray(result.jobs))
    assert.ok(
      elapsed < LIVE_LATENCY_BUDGET_MS,
      `fetch took ${elapsed}ms, budget ${LIVE_LATENCY_BUDGET_MS}ms`
    )

    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^smartrecruiters:.+/)
      assert.ok(sample.title.length > 0)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
