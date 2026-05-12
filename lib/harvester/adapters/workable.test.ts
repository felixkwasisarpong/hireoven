import { strict as assert } from "node:assert"
import { test } from "node:test"
import { workableAdapter } from "./workable"

test("workable: detectFromUrl resolves an apply.workable.com URL", () => {
  assert.deepEqual(
    workableAdapter.detectFromUrl("https://apply.workable.com/loomly/"),
    { slug: "loomly" }
  )
})

test("workable: detectFromUrl strips trailing path segments", () => {
  assert.deepEqual(
    workableAdapter.detectFromUrl("https://apply.workable.com/loomly/j/ABC123"),
    { slug: "loomly" }
  )
})

test("workable: detectFromUrl returns null for non-Workable hosts", () => {
  assert.equal(workableAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

test("workable: detectFromUrl returns null when slug is missing or malformed", () => {
  assert.equal(workableAdapter.detectFromUrl("https://apply.workable.com/"), null)
  assert.equal(workableAdapter.detectFromUrl("https://apply.workable.com/!!"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_WORKABLE_SLUG ?? "loomly"
const LIVE_LATENCY_BUDGET_MS = Number.parseInt(
  process.env.HARVESTER_LIVE_LATENCY_BUDGET_MS ?? "10000",
  10
)

test(
  "workable: live fetch returns a shaped response within latency budget",
  { skip: !LIVE },
  async () => {
    const startedAt = Date.now()
    let result
    try {
      result = await workableAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      const status = (error as { status?: number | null }).status
      if (status === 404) return
      throw error
    }
    const elapsed = Date.now() - startedAt

    assert.equal(result.sourceAts, "workable")
    assert.equal(result.sourceAtsSlug, LIVE_SLUG)
    assert.equal(result.notModified, false)
    assert.ok(Array.isArray(result.jobs))
    assert.ok(
      elapsed < LIVE_LATENCY_BUDGET_MS,
      `fetch took ${elapsed}ms, budget ${LIVE_LATENCY_BUDGET_MS}ms`
    )

    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^workable:.+/)
      assert.ok(sample.title.length > 0)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
