import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, detectFromUrl, mapItemToJob, ukfindajobAdapter } from "./ukfindajob"

test("ukfindajob: detectFromUrl accepts /search?q=<slug>", () => {
  assert.deepEqual(
    ukfindajobAdapter.detectFromUrl("https://findajob.dwp.gov.uk/search?q=nurse"),
    { slug: "nurse" }
  )
})

test("ukfindajob: detectFromUrl accepts /sector/<slug>", () => {
  assert.deepEqual(ukfindajobAdapter.detectFromUrl("https://findajob.dwp.gov.uk/sector/it"), {
    slug: "it",
  })
})

test("ukfindajob: detectFromUrl rejects non-FindAJob hosts + malformed slugs", () => {
  assert.equal(ukfindajobAdapter.detectFromUrl("https://www.example.com/search?q=foo"), null)
  assert.equal(ukfindajobAdapter.detectFromUrl("https://findajob.dwp.gov.uk/search"), null)
  assert.equal(ukfindajobAdapter.detectFromUrl("https://findajob.dwp.gov.uk/sector/"), null)
  assert.equal(
    ukfindajobAdapter.detectFromUrl("https://findajob.dwp.gov.uk/sector/bad%2Fslug"),
    null
  )
})

test("ukfindajob: buildJobsUrl encodes the facet token + appends page", () => {
  const url = buildJobsUrl("care worker", 3)
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get("q"), "care worker")
  assert.equal(parsed.searchParams.get("page"), "3")
})

test("ukfindajob: mapItemToJob extracts title, salary, location, description", () => {
  const job = mapItemToJob("nurse", {
    reference: "UK-2024-0001",
    jobTitle: "Staff Nurse",
    detailUrl: "https://findajob.dwp.gov.uk/details/UK-2024-0001",
    locationName: "Manchester",
    datePosted: "2026-04-01T00:00:00Z",
    salaryMin: "28000",
    salaryMax: "35000",
    contractType: "Permanent",
    summary: "Care for patients on a busy ward.",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "ukfindajob:nurse:UK-2024-0001")
  assert.equal(job!.title, "Staff Nurse")
  assert.equal(job!.applyUrl, "https://findajob.dwp.gov.uk/details/UK-2024-0001")
  assert.equal(job!.location, "Manchester")
  assert.equal(job!.salaryMin, 28_000)
  assert.equal(job!.salaryMax, 35_000)
  assert.equal(job!.salaryCurrency, "GBP")
  assert.equal(job!.employmentType, "Permanent")
  assert.equal(job!.postedAt, "2026-04-01T00:00:00.000Z")
  assert.match(job!.description ?? "", /busy ward/)
})

test("ukfindajob: mapItemToJob falls back to synthetic applyUrl + town/region location", () => {
  const job = mapItemToJob("it", {
    id: 9876,
    title: "Software Developer",
    town: "Leeds",
    region: "West Yorkshire",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "ukfindajob:it:9876")
  assert.equal(job!.location, "Leeds, West Yorkshire")
  assert.equal(job!.applyUrl, "https://findajob.dwp.gov.uk/details/9876")
})

test("ukfindajob: mapItemToJob returns null for items missing title/id", () => {
  assert.equal(mapItemToJob("it", { id: "1" }), null)
  assert.equal(mapItemToJob("it", { title: "x" }), null)
})

test("ukfindajob: fetchJobs paginates across a bare-array page then a short page", async () => {
  // Page 1: full page (50) as a BARE ARRAY → no total → must continue.
  // Page 2: 1 job (short page) → stop.
  const page1 = Array.from({ length: 50 }, (_, i) => ({
    id: `id-${i + 1}`,
    title: `Job ${i + 1}`,
    url: `https://findajob.dwp.gov.uk/details/${i + 1}`,
  }))
  const page2 = [
    { id: "id-51", title: "Job 51", url: "https://findajob.dwp.gov.uk/details/51" },
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

  const result = await ukfindajobAdapter.fetchJobs({
    slug: "nurse",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "ukfindajob")
  assert.equal(result.sourceAtsSlug, "nurse")
  assert.equal(result.jobs.length, 51)
  assert.equal(result.jobs[0]?.externalId, "ukfindajob:nurse:id-1")
  assert.equal(result.jobs[50]?.externalId, "ukfindajob:nurse:id-51")
})
