import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, detectFromUrl, mapItemToJob, euresAdapter } from "./eures"

test("eures: detectFromUrl accepts /search?q=<slug>", () => {
  assert.deepEqual(
    euresAdapter.detectFromUrl("https://eures.europa.eu/search?q=software-developer"),
    { slug: "software-developer" }
  )
})

test("eures: detectFromUrl accepts /sector/<slug>", () => {
  assert.deepEqual(euresAdapter.detectFromUrl("https://eures.europa.eu/sector/healthcare"), {
    slug: "healthcare",
  })
})

test("eures: detectFromUrl rejects non-EURES hosts + malformed slugs", () => {
  assert.equal(euresAdapter.detectFromUrl("https://www.example.com/search?q=foo"), null)
  assert.equal(euresAdapter.detectFromUrl("https://eures.europa.eu/search"), null)
  assert.equal(euresAdapter.detectFromUrl("https://eures.europa.eu/sector/"), null)
  // Slug with bad characters (slash).
  assert.equal(euresAdapter.detectFromUrl("https://eures.europa.eu/sector/bad%2Fslug"), null)
})

test("eures: buildJobsUrl encodes the facet token + appends page", () => {
  const url = buildJobsUrl("data science", 2)
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get("q"), "data science")
  assert.equal(parsed.searchParams.get("page"), "2")
})

test("eures: mapItemToJob extracts title, salary, location, description", () => {
  const job = mapItemToJob("healthcare", {
    id: "EU-2024-0001",
    jobTitle: "Registered Nurse",
    applyUrl: "https://eures.europa.eu/jobs/EU-2024-0001/apply",
    locationName: "Berlin, Germany",
    publicationDate: "2026-05-10T00:00:00Z",
    minSalary: "45000",
    maxSalary: "60000",
    currency: "EUR",
    contractType: "Full-time",
    description: "Provide patient care at a public hospital.",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "eures:healthcare:EU-2024-0001")
  assert.equal(job!.title, "Registered Nurse")
  assert.equal(job!.applyUrl, "https://eures.europa.eu/jobs/EU-2024-0001/apply")
  assert.equal(job!.location, "Berlin, Germany")
  assert.equal(job!.salaryMin, 45_000)
  assert.equal(job!.salaryMax, 60_000)
  assert.equal(job!.salaryCurrency, "EUR")
  assert.equal(job!.employmentType, "Full-time")
  assert.equal(job!.postedAt, "2026-05-10T00:00:00.000Z")
  assert.match(job!.description ?? "", /Provide patient care/)
})

test("eures: mapItemToJob falls back to synthetic applyUrl + city/country location", () => {
  const job = mapItemToJob("it", {
    jobId: 12345,
    title: "Backend Engineer",
    city: "Lisbon",
    country: "Portugal",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "eures:it:12345")
  assert.equal(job!.location, "Lisbon, Portugal")
  assert.equal(job!.applyUrl, "https://eures.europa.eu/jobs/12345")
})

test("eures: mapItemToJob returns null for items missing title/id", () => {
  assert.equal(mapItemToJob("it", { id: "1" }), null)
  assert.equal(mapItemToJob("it", { title: "x" }), null)
})

test("eures: fetchJobs paginates across a bare-array page then a short page", async () => {
  // Page 1: full page (100) as a BARE ARRAY → no total → must continue.
  // Page 2: 1 job (short page) → stop.
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: `id-${i + 1}`,
    title: `Job ${i + 1}`,
    applyUrl: `https://eures.europa.eu/jobs/${i + 1}`,
  }))
  const page2 = [
    { id: "id-101", title: "Job 101", applyUrl: "https://eures.europa.eu/jobs/101" },
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

  const result = await euresAdapter.fetchJobs({
    slug: "healthcare",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "eures")
  assert.equal(result.sourceAtsSlug, "healthcare")
  assert.equal(result.notModified, false)
  assert.equal(result.etag, null)
  assert.equal(result.lastModified, null)
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "eures:healthcare:id-1")
  assert.equal(result.jobs[100]?.externalId, "eures:healthcare:id-101")
})
