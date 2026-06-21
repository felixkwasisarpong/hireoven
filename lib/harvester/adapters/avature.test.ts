import { strict as assert } from "node:assert"
import { test } from "node:test"
import { avatureAdapter, buildJobsUrl, mapItemToJob } from "./avature"

test("avature: detectFromUrl accepts <company>.avature.net/careers", () => {
  assert.deepEqual(
    avatureAdapter.detectFromUrl("https://acme.avature.net/careers"),
    { slug: "acme" }
  )
})

test("avature: detectFromUrl rejects www + bare + non-avature hosts + malformed", () => {
  assert.equal(avatureAdapter.detectFromUrl("https://www.avature.net/"), null)
  assert.equal(avatureAdapter.detectFromUrl("https://avature.net/"), null)
  assert.equal(avatureAdapter.detectFromUrl("https://www.example.com/careers/acme"), null)
  assert.equal(avatureAdapter.detectFromUrl("not a url"), null)
})

test("avature: buildJobsUrl encodes company subdomain + page", () => {
  const url = new URL(buildJobsUrl("acme-co", 3))
  assert.equal(url.hostname, "acme-co.avature.net")
  assert.match(url.pathname, /\/careers\/SearchJobs/)
  assert.equal(url.searchParams.get("page"), "3")
})

test("avature: mapItemToJob maps fields with fallbacks", () => {
  const job = mapItemToJob("acme", {
    jobId: 7788,
    positionTitle: "Software Engineer",
    jobDescription: "Build great things.",
    locationName: "Reno, NV",
    jobType: "Full-time",
    publishedAt: "2026-05-01T00:00:00Z",
    payMin: "120000",
    payMax: "160000",
    currency: "USD",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "avature:acme:7788")
  assert.equal(job!.title, "Software Engineer")
  assert.equal(job!.location, "Reno, NV")
  assert.equal(job!.employmentType, "Full-time")
  assert.equal(job!.salaryMin, 120_000)
  assert.equal(job!.salaryMax, 160_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, "2026-05-01T00:00:00.000Z")
  assert.match(job!.applyUrl, /acme\.avature\.net\/careers\/JobDetail\/7788/)
})

test("avature: mapItemToJob returns null when title or id missing", () => {
  assert.equal(mapItemToJob("acme", { id: "1" }), null)
  assert.equal(mapItemToJob("acme", { title: "x" }), null)
})

test("avature: fetchJobs reads envelope + paginates bare arrays", async () => {
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

  const result = await avatureAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "avature")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "avature:acme:p1-1")
  assert.equal(result.jobs[100]?.externalId, "avature:acme:p2-1")
})

test("avature: fetchJobs throws on first-page error", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 404 })
  await assert.rejects(
    avatureAdapter.fetchJobs({
      slug: "acme",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /avature fetch failed/
  )
})
