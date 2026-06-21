import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildJobsUrl, mapItemToJob, neogovAdapter } from "./neogov"

test("neogov: detectFromUrl accepts /careers/<agency>", () => {
  assert.deepEqual(
    neogovAdapter.detectFromUrl("https://www.governmentjobs.com/careers/sanjose"),
    { slug: "sanjose" }
  )
  assert.deepEqual(
    neogovAdapter.detectFromUrl("https://www.governmentjobs.com/careers/lacity/jobs"),
    { slug: "lacity" }
  )
  // schooljobs sibling host
  assert.deepEqual(
    neogovAdapter.detectFromUrl("https://www.schooljobs.com/careers/somedistrict"),
    { slug: "somedistrict" }
  )
})

test("neogov: detectFromUrl rejects non-NEOGOV hosts + malformed slugs", () => {
  assert.equal(neogovAdapter.detectFromUrl("https://www.example.com/careers/sanjose"), null)
  assert.equal(neogovAdapter.detectFromUrl("https://www.governmentjobs.com/"), null)
  assert.equal(neogovAdapter.detectFromUrl("https://www.governmentjobs.com/careers/"), null)
  // slug with a slash (path-encoded) should not pass the slug regex
  assert.equal(
    neogovAdapter.detectFromUrl("https://www.governmentjobs.com/careers/bad%2Fslug"),
    null
  )
})

test("neogov: buildJobsUrl encodes the agency + page", () => {
  const url = buildJobsUrl("sanjose", 3)
  assert.equal(url, "https://www.governmentjobs.com/careers/sanjose/jobs?page=3")
})

test("neogov: mapItemToJob extracts title, salary, location, employment type, date", () => {
  const job = mapItemToJob("sanjose", {
    Id: 12345,
    Title: "Senior Civil Engineer",
    Location: "San Jose, CA",
    SalaryMin: "110000",
    SalaryMax: "140000",
    JobType: "Full-Time",
    OpenDate: "2026-05-10T00:00:00Z",
    Description: "Lead public infrastructure projects.",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "neogov:sanjose:12345")
  assert.equal(job!.title, "Senior Civil Engineer")
  assert.equal(
    job!.applyUrl,
    "https://www.governmentjobs.com/careers/sanjose/jobs/12345"
  )
  assert.equal(job!.location, "San Jose, CA")
  assert.equal(job!.salaryMin, 110_000)
  assert.equal(job!.salaryMax, 140_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.employmentType, "Full-Time")
  assert.equal(job!.postedAt, "2026-05-10T00:00:00.000Z")
  assert.match(job!.description ?? "", /infrastructure/)
})

test("neogov: mapItemToJob honors fallback field names ($-formatted salary, JobTitle)", () => {
  const job = mapItemToJob("lacity", {
    JobId: "abc-9",
    JobTitle: "Budget Analyst",
    LocationDisplay: "Los Angeles",
    SalaryRangeMin: "$85,000",
    SalaryRangeMax: "$95,000",
    JobSummary: "Analyze the city budget.",
  })
  assert.ok(job)
  assert.equal(job!.externalId, "neogov:lacity:abc-9")
  assert.equal(job!.title, "Budget Analyst")
  assert.equal(job!.location, "Los Angeles")
  assert.equal(job!.salaryMin, 85_000)
  assert.equal(job!.salaryMax, 95_000)
})

test("neogov: mapItemToJob returns null when title or id missing", () => {
  assert.equal(mapItemToJob("sanjose", { Id: 1 }), null)
  assert.equal(mapItemToJob("sanjose", { Title: "x" }), null)
})

test("neogov: fetchJobs reads array + object envelopes and paginates", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    Id: i + 1,
    Title: `Job ${i + 1}`,
  }))
  const page2 = { Jobs: [{ Id: 101, Title: "Job 101" }], TotalCount: 101 }

  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const page = new URL(raw).searchParams.get("page")
    const body = page === "1" ? page1 : page2
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    })
  }

  const result = await neogovAdapter.fetchJobs({
    slug: "sanjose",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "neogov")
  assert.equal(result.sourceAtsSlug, "sanjose")
  assert.equal(result.jobs.length, 101)
  assert.equal(result.jobs[0]?.externalId, "neogov:sanjose:1")
  assert.equal(result.jobs[100]?.externalId, "neogov:sanjose:101")
})

test("neogov: fetchJobs throws on first-page failure", async () => {
  const fetchImpl: typeof fetch = async () => new Response("nope", { status: 404 })
  await assert.rejects(
    neogovAdapter.fetchJobs({
      slug: "sanjose",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /neogov fetch failed/
  )
})
