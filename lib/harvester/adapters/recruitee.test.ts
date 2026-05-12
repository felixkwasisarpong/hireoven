import { strict as assert } from "node:assert"
import { test } from "node:test"
import { recruiteeAdapter } from "./recruitee"

test("recruitee: detectFromUrl resolves a {slug}.recruitee.com URL", () => {
  assert.deepEqual(
    recruiteeAdapter.detectFromUrl("https://acme-co.recruitee.com/"),
    { slug: "acme-co" }
  )
})

test("recruitee: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(recruiteeAdapter.detectFromUrl("https://www.recruitee.com/"), null)
  assert.equal(recruiteeAdapter.detectFromUrl("https://app.recruitee.com/"), null)
})

test("recruitee: detectFromUrl rejects non-Recruitee hosts", () => {
  assert.equal(recruiteeAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_RECRUITEE_SLUG ?? "recruitee"

test(
  "recruitee: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await recruiteeAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "recruitee")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^recruitee:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
