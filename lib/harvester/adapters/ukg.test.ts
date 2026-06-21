import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, ukgAdapter, mapItemToJob } from "./ukg"

test("ukg: detectFromUrl accepts recruiting.ultipro.com/<company>/JobBoard", () => {
  assert.deepEqual(
    ukgAdapter.detectFromUrl(
      "https://recruiting.ultipro.com/ACM1001ACME/JobBoard/abc-guid/OpportunityDetail"
    ),
    { slug: "ACM1001ACME" }
  )
})

test("ukg: detectFromUrl accepts recruiting2.ultipro.com", () => {
  assert.deepEqual(
    ukgAdapter.detectFromUrl(
      "https://recruiting2.ultipro.com/ACM1001ACME/JobBoard/abc-guid/OpportunityDetail"
    ),
    { slug: "ACM1001ACME" }
  )
})

test("ukg: detectFromUrl accepts *.ukg.net subdomain", () => {
  assert.deepEqual(
    ukgAdapter.detectFromUrl("https://acme.ukg.net/ACM1001ACME/JobBoard/abc-guid"),
    { slug: "ACM1001ACME" }
  )
})

test("ukg: detectFromUrl rejects non-ukg hosts + malformed", () => {
  assert.equal(ukgAdapter.detectFromUrl("https://www.example.com/ACM1001ACME"), null)
  assert.equal(ukgAdapter.detectFromUrl("https://recruiting.ultipro.com/"), null)
  assert.equal(ukgAdapter.detectFromUrl("not a url"), null)
})

test("ukg: buildJobsUrl encodes company + page", () => {
  const url = new URL(buildJobsUrl("ACM1001ACME", 3))
  assert.equal(url.hostname, "recruiting.ultipro.com")
  assert.match(url.pathname, /\/ACM1001ACME\/JobBoard\/list/)
  assert.equal(url.searchParams.get("page"), "3")
})

test("ukg: mapItemToJob maps fields with fallbacks", () => {
  const job = mapItemToJob("ACM1001ACME", {
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
  assert.equal(job!.externalId, "ukg:ACM1001ACME:7788")
  assert.equal(job!.title, "Warehouse Associate")
  assert.equal(job!.location, "Reno, NV")
  assert.equal(job!.employmentType, "Part-time")
  assert.equal(job!.salaryMin, 32_000)
  assert.equal(job!.salaryMax, 41_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, "2026-05-01T00:00:00.000Z")
  assert.match(job!.applyUrl, /\/ACM1001ACME\/JobBoard\/Opportunity\/7788/)
})

test("ukg: mapItemToJob returns null when title or id missing", () => {
  assert.equal(mapItemToJob("ACM1001ACME", { id: "1" }), null)
  assert.equal(mapItemToJob("ACM1001ACME", { title: "x" }), null)
})

test("ukg: fetchJobs reads envelope + paginates bare arrays", async () => {
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

  const result = await ukgAdapter.fetchJobs({
    slug: "ACM1001ACME",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "ukg")
  assert.equal(result.sourceAtsSlug, "ACM1001ACME")
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "ukg:ACM1001ACME:p1-1")
  assert.equal(result.jobs[100]?.externalId, "ukg:ACM1001ACME:p2-1")
})

test("ukg: fetchJobs throws on first-page error", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 404 })
  await assert.rejects(
    ukgAdapter.fetchJobs({
      slug: "ACM1001ACME",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /ukg fetch failed/
  )
})
