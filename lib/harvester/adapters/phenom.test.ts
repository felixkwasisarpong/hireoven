import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, phenomAdapter, mapItemToJob } from "./phenom"

test("phenom: detectFromUrl accepts <company>.phenompeople.com subdomain", () => {
  assert.deepEqual(
    phenomAdapter.detectFromUrl("https://acme.phenompeople.com/careers"),
    { slug: "acme" }
  )
})

test("phenom: detectFromUrl rejects www + bare host + wrong host + malformed", () => {
  assert.equal(phenomAdapter.detectFromUrl("https://www.phenompeople.com/"), null)
  assert.equal(phenomAdapter.detectFromUrl("https://phenompeople.com/"), null)
  assert.equal(phenomAdapter.detectFromUrl("https://www.example.com/careers/acme"), null)
  assert.equal(phenomAdapter.detectFromUrl("not a url"), null)
})

test("phenom: buildJobsUrl substitutes company host + page", () => {
  const url = new URL(buildJobsUrl("acme", 3))
  assert.equal(url.hostname, "acme.phenompeople.com")
  assert.match(url.pathname, /\/api\/jobs/)
  assert.equal(url.searchParams.get("page"), "3")
})

test("phenom: mapItemToJob maps fields with fallbacks", () => {
  const job = mapItemToJob("acme", {
    jobId: 7788,
    positionTitle: "Software Engineer",
    jobDescription: "Build great products.",
    locationName: "Austin, TX",
    jobType: "Full-time",
    publishedAt: "2026-05-01T00:00:00Z",
    payMin: "120000",
    payMax: "160000",
    currency: "USD",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "phenom:acme:7788")
  assert.equal(job!.title, "Software Engineer")
  assert.equal(job!.location, "Austin, TX")
  assert.equal(job!.employmentType, "Full-time")
  assert.equal(job!.salaryMin, 120_000)
  assert.equal(job!.salaryMax, 160_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, "2026-05-01T00:00:00.000Z")
  assert.match(job!.applyUrl, /\/job\/7788/)
})

test("phenom: mapItemToJob returns null when title or id missing", () => {
  assert.equal(mapItemToJob("acme", { id: "1" }), null)
  assert.equal(mapItemToJob("acme", { title: "x" }), null)
})

test("phenom: fetchJobs reads envelope + paginates bare arrays", async () => {
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

  const result = await phenomAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "phenom")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "phenom:acme:p1-1")
  assert.equal(result.jobs[100]?.externalId, "phenom:acme:p2-1")
})

test("phenom: fetchJobs throws on first-page error", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 404 })
  await assert.rejects(
    phenomAdapter.fetchJobs({
      slug: "acme",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /phenom fetch failed/
  )
})
