import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, paycomAdapter, mapItemToJob } from "./paycom"

test("paycom: detectFromUrl accepts paycomonline.net clientkey URL", () => {
  assert.deepEqual(
    paycomAdapter.detectFromUrl(
      "https://www.paycomonline.net/v4/ats/web.php/jobs?clientkey=ABC123XYZ"
    ),
    { slug: "ABC123XYZ" }
  )
})

test("paycom: detectFromUrl accepts www.paycom.com/careers/<company>", () => {
  assert.deepEqual(
    paycomAdapter.detectFromUrl("https://www.paycom.com/careers/acme"),
    { slug: "acme" }
  )
})

test("paycom: detectFromUrl rejects non-paycom hosts + malformed", () => {
  assert.equal(paycomAdapter.detectFromUrl("https://www.example.com/careers/acme"), null)
  assert.equal(paycomAdapter.detectFromUrl("https://www.paycom.com/careers/"), null)
  assert.equal(
    paycomAdapter.detectFromUrl("https://www.paycomonline.net/v4/ats/web.php/jobs"),
    null
  )
  assert.equal(paycomAdapter.detectFromUrl("not a url"), null)
})

test("paycom: buildJobsUrl encodes company + page", () => {
  const url = new URL(buildJobsUrl("acme-co", 3))
  assert.equal(url.hostname, "www.paycomonline.net")
  assert.match(url.pathname, /\/v4\/ats\/web\.php\/jobs\.json/)
  assert.equal(url.searchParams.get("clientkey"), "acme-co")
  assert.equal(url.searchParams.get("page"), "3")
})

test("paycom: mapItemToJob maps fields with fallbacks", () => {
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
  assert.equal(job!.externalId, "paycom:acme:7788")
  assert.equal(job!.title, "Warehouse Associate")
  assert.equal(job!.location, "Reno, NV")
  assert.equal(job!.employmentType, "Part-time")
  assert.equal(job!.salaryMin, 32_000)
  assert.equal(job!.salaryMax, 41_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, "2026-05-01T00:00:00.000Z")
  assert.match(job!.applyUrl, /clientkey=acme&job=7788/)
})

test("paycom: mapItemToJob returns null when title or id missing", () => {
  assert.equal(mapItemToJob("acme", { id: "1" }), null)
  assert.equal(mapItemToJob("acme", { title: "x" }), null)
})

test("paycom: fetchJobs reads envelope + paginates bare arrays", async () => {
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

  const result = await paycomAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "paycom")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "paycom:acme:p1-1")
  assert.equal(result.jobs[100]?.externalId, "paycom:acme:p2-1")
})

test("paycom: fetchJobs throws on first-page error", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("nope", { status: 404 })
  await assert.rejects(
    paycomAdapter.fetchJobs({
      slug: "acme",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /paycom fetch failed/
  )
})
