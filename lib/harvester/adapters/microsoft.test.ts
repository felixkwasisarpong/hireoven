import { strict as assert } from "node:assert"
import { test } from "node:test"
import { microsoftAdapter } from "./microsoft"

test("microsoft: detectFromUrl matches careers.microsoft.com hosts", () => {
  assert.deepEqual(microsoftAdapter.detectFromUrl("https://jobs.careers.microsoft.com/global/en/job/200040220"), { slug: "microsoft" })
  assert.deepEqual(microsoftAdapter.detectFromUrl("https://apply.careers.microsoft.com/api/pcsx/search"), { slug: "microsoft" })
})

test("microsoft: detectFromUrl rejects non-Microsoft hosts", () => {
  assert.equal(microsoftAdapter.detectFromUrl("https://careers.google.com/jobs"), null)
  assert.equal(microsoftAdapter.detectFromUrl("https://www.microsoft.com/store"), null)
})

test("microsoft: paginates search, filters US/CA, fetches JD from detail", async () => {
  const search = {
    data: {
      count: 2,
      positions: [
        {
          id: 1970393556874693,
          displayJobId: "200040220",
          name: "Senior Cloud Solution Architect",
          locations: ["United States, Washington, Redmond"],
          standardizedLocations: ["Redmond, Washington, US"],
          postedTs: 1780946954,
        },
        {
          id: 1970393556875012,
          displayJobId: "200040353",
          name: "Software Engineer",
          locations: ["China, Beijing"],
          standardizedLocations: ["Beijing, Beijing, CN"], // filtered out
          postedTs: 1780946000,
        },
      ],
    },
  }
  const detail = { data: { jobDescription: "<p>Build Azure systems.</p><ul><li>5+ years</li><li>C#, TypeScript</li></ul>" + "x".repeat(220) } }

  const fetchImpl = (async (url: string) => {
    const body = String(url).includes("/position_details") ? detail : search
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
  }) as unknown as typeof fetch

  const result = await microsoftAdapter.fetchJobs({
    slug: "microsoft",
    ctx: { etag: null, lastModified: null, timeoutMs: 5_000, fetchImpl },
  })

  assert.equal(result.sourceAts, "microsoft")
  assert.equal(result.jobs.length, 1) // CN row filtered out

  const job = result.jobs[0]
  assert.equal(job.externalId, "200040220")
  assert.equal(job.title, "Senior Cloud Solution Architect")
  assert.equal(job.applyUrl, "https://jobs.careers.microsoft.com/global/en/job/200040220")
  assert.equal(job.location, "United States, Washington, Redmond")
  assert.equal(job.postedAt, new Date(1780946954 * 1000).toISOString())
  assert.match(job.contentHash, /^[0-9a-f]{32}$/)
  assert.ok((job.description?.length ?? 0) > 200)
  assert.ok(!job.description?.includes("<")) // HTML stripped
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
test("microsoft: live fetch returns shaped US jobs", { skip: !LIVE }, async () => {
  process.env.HARVESTER_MICROSOFT_MAX_PAGES = "2"
  process.env.HARVESTER_MICROSOFT_DETAIL_MAX_JOBS = "2"
  const result = await microsoftAdapter.fetchJobs({ slug: "microsoft", ctx: { etag: null, lastModified: null } })
  assert.equal(result.sourceAts, "microsoft")
  assert.ok(result.jobs.length > 0)
  assert.match(result.jobs[0].applyUrl, /jobs\.careers\.microsoft\.com/)
})
