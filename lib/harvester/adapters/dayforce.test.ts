import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, dayforceAdapter, mapItemToJob } from "./dayforce"

test("dayforce: detectFromUrl accepts CandidatePortal/<locale>/<client>/Posting/View/<id>", () => {
  assert.deepEqual(
    dayforceAdapter.detectFromUrl(
      "https://us.dayforcehcm.com/CandidatePortal/en-US/acmecorp/Posting/View/123"
    ),
    { slug: "acmecorp" }
  )
})

test("dayforce: detectFromUrl accepts CandidatePortal/<locale>/<client>/ root", () => {
  assert.deepEqual(
    dayforceAdapter.detectFromUrl("https://us.dayforcehcm.com/CandidatePortal/en-US/acmecorp/"),
    { slug: "acmecorp" }
  )
})

test("dayforce: detectFromUrl rejects non-dayforce hosts + malformed + missing token", () => {
  assert.equal(
    dayforceAdapter.detectFromUrl("https://www.example.com/CandidatePortal/en-US/acmecorp"),
    null
  )
  assert.equal(dayforceAdapter.detectFromUrl("https://us.dayforcehcm.com/"), null)
  assert.equal(dayforceAdapter.detectFromUrl("not a url"), null)
})

test("dayforce: buildJobsUrl encodes company + page", () => {
  const url = new URL(buildJobsUrl("acme-co", 3))
  assert.equal(url.hostname, "us.dayforcehcm.com")
  assert.match(url.pathname, /\/api\/acme-co\/v1\/JobPosting/)
  assert.equal(url.searchParams.get("page"), "3")
})

test("dayforce: mapItemToJob maps fields with fallbacks", () => {
  const job = mapItemToJob("acme", {
    jobId: 7788,
    positionTitle: "Warehouse Associate",
    jobDescription: "Pick and pack orders.",
    locationName: "Reno, NV",
    jobType: "Part-time",
    publishedAt: "2026-05-01T00:00:00Z",
    payMin: "32000",
    payMax: "41000",
    currency: "USD",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "dayforce:acme:7788")
  assert.equal(job!.title, "Warehouse Associate")
  assert.equal(job!.location, "Reno, NV")
  assert.equal(job!.employmentType, "Part-time")
  assert.equal(job!.salaryMin, 32_000)
  assert.equal(job!.salaryMax, 41_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, "2026-05-01T00:00:00.000Z")
  assert.match(job!.applyUrl, /\/CandidatePortal\/en-US\/acme\/Posting\/View\/7788/)
})

test("dayforce: mapItemToJob returns null when title or id missing", () => {
  assert.equal(mapItemToJob("acme", { id: "1" }), null)
  assert.equal(mapItemToJob("acme", { title: "x" }), null)
})

test("dayforce: fetchJobs reads envelope + paginates bare arrays", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: `p1-${i + 1}`,
    title: `Job ${i + 1}`,
  }))
  const page2 = [{ id: "p2-1", title: "Last Job" }]

  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    const page = url.searchParams.get("page")
    const body = page === "1" ? page1 : page === "2" ? page2 : []
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    })
  }

  const result = await dayforceAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "dayforce")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "dayforce:acme:p1-1")
  assert.equal(result.jobs[100]?.externalId, "dayforce:acme:p2-1")
})

test("dayforce: fetchJobs throws on first-page error", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 404 })
  await assert.rejects(
    dayforceAdapter.fetchJobs({
      slug: "acme",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /dayforce fetch failed/
  )
})
