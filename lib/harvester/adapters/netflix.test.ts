import { strict as assert } from "node:assert"
import { test } from "node:test"
import { netflixAdapter } from "./netflix"

test("netflix: detectFromUrl matches explore.jobs.netflix.net", () => {
  assert.deepEqual(netflixAdapter.detectFromUrl("https://explore.jobs.netflix.net/careers/job/123"), { slug: "netflix" })
})

test("netflix: detectFromUrl rejects other hosts", () => {
  assert.equal(netflixAdapter.detectFromUrl("https://jobs.netflix.com/search"), null)
  assert.equal(netflixAdapter.detectFromUrl("https://explore.jobs.other.net/careers"), null)
})

test("netflix: paginates list, filters US/CA, fetches JD from detail", async () => {
  const list = {
    count: 2,
    positions: [
      {
        id: 790298014263,
        name: "AI Engineer 6, Ads Platform",
        location: "USA - Remote",
        locations: ["USA - Remote"],
        t_update: 1779148800,
        canonicalPositionUrl: "https://explore.jobs.netflix.net/careers/job/790298014263",
      },
      {
        id: 790316328000,
        name: "Content Manager, EMEA",
        location: "London, United Kingdom",
        locations: ["London, United Kingdom"], // filtered out
        t_update: 1779000000,
      },
    ],
  }
  const detail = { id: 790298014263, name: "AI Engineer 6, Ads Platform", job_description: "<p>Build ML systems.</p><ul><li>Python</li></ul>" + "y".repeat(220) }

  const fetchImpl = (async (url: string) => {
    const u = String(url)
    const body = /\/jobs\/\d+\?/.test(u) ? detail : list // detail has id in the path
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
  }) as unknown as typeof fetch

  const result = await netflixAdapter.fetchJobs({
    slug: "netflix",
    ctx: { etag: null, lastModified: null, timeoutMs: 5_000, fetchImpl },
  })

  assert.equal(result.sourceAts, "netflix")
  assert.equal(result.jobs.length, 1) // UK row filtered out

  const job = result.jobs[0]
  assert.equal(job.externalId, "790298014263")
  assert.equal(job.title, "AI Engineer 6, Ads Platform")
  assert.equal(job.applyUrl, "https://explore.jobs.netflix.net/careers/job/790298014263")
  assert.equal(job.location, "USA - Remote")
  assert.equal(job.postedAt, new Date(1779148800 * 1000).toISOString())
  assert.match(job.contentHash, /^[0-9a-f]{32}$/)
  assert.ok((job.description?.length ?? 0) > 200)
  assert.ok(!job.description?.includes("<"))
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
test("netflix: live fetch returns shaped US jobs", { skip: !LIVE }, async () => {
  process.env.HARVESTER_NETFLIX_MAX_PAGES = "2"
  process.env.HARVESTER_NETFLIX_DETAIL_MAX_JOBS = "2"
  const result = await netflixAdapter.fetchJobs({ slug: "netflix", ctx: { etag: null, lastModified: null } })
  assert.equal(result.sourceAts, "netflix")
  assert.ok(result.jobs.length > 0)
  assert.match(result.jobs[0].applyUrl, /explore\.jobs\.netflix\.net/)
})
