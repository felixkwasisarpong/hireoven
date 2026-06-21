import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  buildJobsUrl,
  detectFromUrl,
  mapItemToJob,
  canadajobbankAdapter,
} from "./canadajobbank"

test("canadajobbank: detectFromUrl accepts /jobsearch?q=<slug>", () => {
  assert.deepEqual(
    canadajobbankAdapter.detectFromUrl("https://www.jobbank.gc.ca/jobsearch?q=welder"),
    { slug: "welder" }
  )
})

test("canadajobbank: detectFromUrl accepts /sector/<slug>", () => {
  assert.deepEqual(
    canadajobbankAdapter.detectFromUrl("https://www.jobbank.gc.ca/sector/construction"),
    { slug: "construction" }
  )
})

test("canadajobbank: detectFromUrl rejects non-JobBank hosts + malformed slugs", () => {
  assert.equal(canadajobbankAdapter.detectFromUrl("https://www.example.com/jobsearch?q=foo"), null)
  assert.equal(canadajobbankAdapter.detectFromUrl("https://www.jobbank.gc.ca/jobsearch"), null)
  assert.equal(canadajobbankAdapter.detectFromUrl("https://www.jobbank.gc.ca/sector/"), null)
  assert.equal(
    canadajobbankAdapter.detectFromUrl("https://www.jobbank.gc.ca/sector/bad%2Fslug"),
    null
  )
})

test("canadajobbank: buildJobsUrl encodes the facet token + appends page", () => {
  const url = buildJobsUrl("heavy equipment", 4)
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get("q"), "heavy equipment")
  assert.equal(parsed.searchParams.get("page"), "4")
})

test("canadajobbank: mapItemToJob extracts title, salary, location, description", () => {
  const job = mapItemToJob("welder", {
    jobOrderId: "CA-2024-0001",
    jobTitle: "Welder",
    detailUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/CA-2024-0001",
    city: "Calgary",
    province: "AB",
    postingDate: "2026-03-15T00:00:00Z",
    salaryMin: "55000",
    salaryMax: "75000",
    employmentType: "Full-time",
    description: "Weld structural steel on commercial sites.",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "canadajobbank:welder:CA-2024-0001")
  assert.equal(job!.title, "Welder")
  assert.equal(job!.applyUrl, "https://www.jobbank.gc.ca/jobsearch/jobposting/CA-2024-0001")
  assert.equal(job!.location, "Calgary, AB")
  assert.equal(job!.salaryMin, 55_000)
  assert.equal(job!.salaryMax, 75_000)
  assert.equal(job!.salaryCurrency, "CAD")
  assert.equal(job!.employmentType, "Full-time")
  assert.equal(job!.postedAt, "2026-03-15T00:00:00.000Z")
  assert.match(job!.description ?? "", /structural steel/)
})

test("canadajobbank: mapItemToJob falls back to synthetic applyUrl + wage salary", () => {
  const job = mapItemToJob("it", {
    id: 4242,
    title: "Systems Analyst",
    wage: "$90,000",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "canadajobbank:it:4242")
  assert.equal(job!.applyUrl, "https://www.jobbank.gc.ca/jobsearch/jobposting/4242")
  assert.equal(job!.salaryMin, 90_000)
  assert.equal(job!.salaryCurrency, "CAD")
})

test("canadajobbank: mapItemToJob returns null for items missing title/id", () => {
  assert.equal(mapItemToJob("it", { id: "1" }), null)
  assert.equal(mapItemToJob("it", { title: "x" }), null)
})

test("canadajobbank: fetchJobs paginates across a bare-array page then a short page", async () => {
  // Page 1: full page (25) as a BARE ARRAY → no total → must continue.
  // Page 2: 1 job (short page) → stop.
  const page1 = Array.from({ length: 25 }, (_, i) => ({
    id: `id-${i + 1}`,
    title: `Job ${i + 1}`,
    url: `https://www.jobbank.gc.ca/jobsearch/jobposting/${i + 1}`,
  }))
  const page2 = [
    {
      id: "id-26",
      title: "Job 26",
      url: "https://www.jobbank.gc.ca/jobsearch/jobposting/26",
    },
  ]

  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    const page = url.searchParams.get("page")
    const body = page === "1" ? page1 : page2
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    })
  }

  const result = await canadajobbankAdapter.fetchJobs({
    slug: "welder",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "canadajobbank")
  assert.equal(result.sourceAtsSlug, "welder")
  assert.equal(result.jobs.length, 26)
  assert.equal(result.jobs[0]?.externalId, "canadajobbank:welder:id-1")
  assert.equal(result.jobs[25]?.externalId, "canadajobbank:welder:id-26")
})
