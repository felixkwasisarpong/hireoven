import { strict as assert } from "node:assert"
import { test } from "node:test"
import { bamboohrAdapter } from "./bamboohr"

test("bamboohr: detectFromUrl resolves a {slug}.bamboohr.com URL", () => {
  assert.deepEqual(bamboohrAdapter.detectFromUrl("https://acme.bamboohr.com/careers"), {
    slug: "acme",
  })
})

test("bamboohr: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(bamboohrAdapter.detectFromUrl("https://www.bamboohr.com/"), null)
  assert.equal(bamboohrAdapter.detectFromUrl("https://app.bamboohr.com/"), null)
})

test("bamboohr: detectFromUrl rejects non-BambooHR hosts", () => {
  assert.equal(bamboohrAdapter.detectFromUrl("https://jobs.lever.co/anduril"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_BAMBOOHR_SLUG ?? "bamboohr"

test(
  "bamboohr: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await bamboohrAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "bamboohr")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^bamboohr:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
