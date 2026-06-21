import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, paylocityAdapter, mapItemToJob } from "./paylocity"

test("paylocity: detectFromUrl accepts recruiting.paylocity.com jobs URL", () => {
  assert.deepEqual(
    paylocityAdapter.detectFromUrl(
      "https://recruiting.paylocity.com/recruiting/jobs/All/a1b2c3d4-1234-5678-9abc-def012345678/Acme-Corp"
    ),
    { slug: "a1b2c3d4-1234-5678-9abc-def012345678" }
  )
})

test("paylocity: detectFromUrl accepts mixed-case path without company name", () => {
  assert.deepEqual(
    paylocityAdapter.detectFromUrl(
      "https://recruiting.paylocity.com/Recruiting/Jobs/All/1234567"
    ),
    { slug: "1234567" }
  )
})

test("paylocity: detectFromUrl rejects non-paylocity hosts + malformed", () => {
  assert.equal(
    paylocityAdapter.detectFromUrl("https://www.example.com/recruiting/jobs/All/123"),
    null
  )
  assert.equal(
    paylocityAdapter.detectFromUrl("https://recruiting.paylocity.com/recruiting/jobs/All/"),
    null
  )
  assert.equal(
    paylocityAdapter.detectFromUrl("https://recruiting.paylocity.com/about"),
    null
  )
  assert.equal(paylocityAdapter.detectFromUrl("not a url"), null)
})

test("paylocity: buildJobsUrl encodes company + page", () => {
  const url = new URL(buildJobsUrl("1234567", 3))
  assert.equal(url.hostname, "recruiting.paylocity.com")
  assert.match(url.pathname, /\/api\/v2\/recruiting\/jobs\/1234567/)
  assert.equal(url.searchParams.get("page"), "3")
})

test("paylocity: mapItemToJob maps fields with fallbacks", () => {
  const job = mapItemToJob("1234567", {
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
  assert.equal(job!.externalId, "paylocity:1234567:7788")
  assert.equal(job!.title, "Warehouse Associate")
  assert.equal(job!.location, "Reno, NV")
  assert.equal(job!.employmentType, "Part-time")
  assert.equal(job!.salaryMin, 32_000)
  assert.equal(job!.salaryMax, 41_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, "2026-05-01T00:00:00.000Z")
  assert.match(job!.applyUrl, /\/recruiting\/jobs\/All\/1234567\/7788/)
})

test("paylocity: mapItemToJob returns null when title or id missing", () => {
  assert.equal(mapItemToJob("1234567", { id: "1" }), null)
  assert.equal(mapItemToJob("1234567", { title: "x" }), null)
})

test("paylocity: fetchJobs reads envelope + paginates bare arrays", async () => {
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

  const result = await paylocityAdapter.fetchJobs({
    slug: "1234567",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "paylocity")
  assert.equal(result.sourceAtsSlug, "1234567")
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "paylocity:1234567:p1-1")
  assert.equal(result.jobs[100]?.externalId, "paylocity:1234567:p2-1")
})

test("paylocity: fetchJobs throws on first-page error", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 404 })
  await assert.rejects(
    paylocityAdapter.fetchJobs({
      slug: "1234567",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /paylocity fetch failed/
  )
})
