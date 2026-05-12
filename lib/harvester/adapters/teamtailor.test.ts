import { strict as assert } from "node:assert"
import { test } from "node:test"
import { teamtailorAdapter } from "./teamtailor"

test("teamtailor: detectFromUrl resolves a {slug}.teamtailor.com URL", () => {
  assert.deepEqual(
    teamtailorAdapter.detectFromUrl("https://acme.teamtailor.com/"),
    { slug: "acme" }
  )
})

test("teamtailor: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(teamtailorAdapter.detectFromUrl("https://www.teamtailor.com/"), null)
  assert.equal(teamtailorAdapter.detectFromUrl("https://app.teamtailor.com/"), null)
})

test("teamtailor: detectFromUrl rejects non-Teamtailor hosts", () => {
  assert.equal(teamtailorAdapter.detectFromUrl("https://jobs.lever.co/anduril"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_TEAMTAILOR_SLUG ?? "teamtailor"

test(
  "teamtailor: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await teamtailorAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "teamtailor")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^teamtailor:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
