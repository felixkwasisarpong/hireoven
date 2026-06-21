import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, fountainAdapter, mapItemToJob } from "./fountain"

test("fountain: detectFromUrl accepts app.fountain.com/careers/<company>", () => {
  assert.deepEqual(
    fountainAdapter.detectFromUrl("https://app.fountain.com/careers/acme"),
    { slug: "acme" }
  )
})

test("fountain: detectFromUrl accepts <company>.fountain.com subdomain", () => {
  assert.deepEqual(fountainAdapter.detectFromUrl("https://acme.fountain.com/jobs"), {
    slug: "acme",
  })
})

test("fountain: detectFromUrl rejects non-fountain hosts + malformed", () => {
  assert.equal(fountainAdapter.detectFromUrl("https://www.example.com/careers/acme"), null)
  assert.equal(fountainAdapter.detectFromUrl("https://app.fountain.com/careers/"), null)
  assert.equal(fountainAdapter.detectFromUrl("https://www.fountain.com/"), null)
  assert.equal(fountainAdapter.detectFromUrl("not a url"), null)
})

test("fountain: buildJobsUrl encodes company + page", () => {
  const url = new URL(buildJobsUrl("acme-co", 3))
  assert.equal(url.hostname, "app.fountain.com")
  assert.match(url.pathname, /\/careers\/acme-co\/positions\.json/)
  assert.equal(url.searchParams.get("page"), "3")
})

test("fountain: mapItemToJob maps fields with fallbacks", () => {
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
  assert.equal(job!.externalId, "fountain:acme:7788")
  assert.equal(job!.title, "Warehouse Associate")
  assert.equal(job!.location, "Reno, NV")
  assert.equal(job!.employmentType, "Part-time")
  assert.equal(job!.salaryMin, 32_000)
  assert.equal(job!.salaryMax, 41_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, "2026-05-01T00:00:00.000Z")
  assert.match(job!.applyUrl, /\/careers\/acme\/apply\/7788/)
})

test("fountain: mapItemToJob returns null when title or id missing", () => {
  assert.equal(mapItemToJob("acme", { id: "1" }), null)
  assert.equal(mapItemToJob("acme", { title: "x" }), null)
})

test("fountain: fetchJobs reads envelope + paginates bare arrays", async () => {
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

  const result = await fountainAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "fountain")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "fountain:acme:p1-1")
  assert.equal(result.jobs[100]?.externalId, "fountain:acme:p2-1")
})

test("fountain: fetchJobs throws on first-page error", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 404 })
  await assert.rejects(
    fountainAdapter.fetchJobs({
      slug: "acme",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /fountain fetch failed/
  )
})
