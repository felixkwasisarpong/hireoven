import { strict as assert } from "node:assert"
import { test } from "node:test"
import { jazzhrAdapter } from "./jazzhr"

test("jazzhr: detectFromUrl resolves a {slug}.applytojob.com URL", () => {
  assert.deepEqual(jazzhrAdapter.detectFromUrl("https://acme.applytojob.com/"), {
    slug: "acme",
  })
})

test("jazzhr: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(jazzhrAdapter.detectFromUrl("https://www.applytojob.com/"), null)
})

test("jazzhr: detectFromUrl rejects non-JazzHR hosts", () => {
  assert.equal(jazzhrAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_JAZZHR_SLUG ?? "jazzhr"

test(
  "jazzhr: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await jazzhrAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "jazzhr")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^jazzhr:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
