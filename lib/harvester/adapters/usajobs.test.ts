import { strict as assert } from "node:assert"
import { test } from "node:test"
import { buildSearchUrl, detectFromUrl, mapItemToJob, usajobsAdapter } from "./usajobs"

test("usajobs: detectFromUrl accepts /Search/Results?d=<slug>", () => {
  assert.deepEqual(
    usajobsAdapter.detectFromUrl(
      "https://www.usajobs.gov/Search/Results?d=Department%20of%20Veterans%20Affairs"
    ),
    { slug: "Department of Veterans Affairs" }
  )
})

test("usajobs: detectFromUrl accepts /agency/<slug>", () => {
  assert.deepEqual(usajobsAdapter.detectFromUrl("https://www.usajobs.gov/agency/VA"), {
    slug: "VA",
  })
})

test("usajobs: detectFromUrl rejects non-USAJOBS hosts + malformed slugs", () => {
  assert.equal(usajobsAdapter.detectFromUrl("https://www.example.com/agency/VA"), null)
  assert.equal(usajobsAdapter.detectFromUrl("https://www.usajobs.gov/Search/Results"), null)
  assert.equal(usajobsAdapter.detectFromUrl("https://www.usajobs.gov/agency/"), null)
  // Slug with bad characters (slash).
  assert.equal(usajobsAdapter.detectFromUrl("https://www.usajobs.gov/agency/bad%2Fslug"), null)
})

test("usajobs: buildSearchUrl encodes the agency name + appends sort fields", () => {
  const url = buildSearchUrl("Department of Defense", 2)
  const parsed = new URL(url)
  assert.equal(parsed.searchParams.get("Organization"), "Department of Defense")
  assert.equal(parsed.searchParams.get("Page"), "2")
  assert.equal(parsed.searchParams.get("SortField"), "OpenDate")
  assert.equal(parsed.searchParams.get("SortDirection"), "Desc")
})

test("usajobs: mapItemToJob extracts title, salary, location, description", () => {
  const job = mapItemToJob("VA", {
    MatchedObjectId: "10005678",
    MatchedObjectDescriptor: {
      PositionID: "VHA-2024-0001",
      PositionTitle: "Registered Nurse",
      PositionURI: "https://www.usajobs.gov/job/10005678",
      ApplyURI: ["https://www.usajobs.gov/job/10005678/apply"],
      PositionLocationDisplay: "Denver, Colorado",
      PositionLocation: [
        {
          LocationName: "Denver, Colorado",
          CityName: "Denver",
          CountrySubDivisionCode: "CO",
          CountryCode: "US",
        },
      ],
      OrganizationName: "Veterans Health Administration",
      DepartmentName: "Department of Veterans Affairs",
      PublicationStartDate: "2026-05-10T00:00:00Z",
      PositionRemuneration: [
        { MinimumRange: "80000", MaximumRange: "120000", RateIntervalCode: "PA" },
      ],
      PositionSchedule: [{ Name: "Full-time" }],
      UserArea: {
        Details: {
          JobSummary: "Provide patient care at the VA hospital.",
          RemoteIndicator: "False",
          TeleworkEligible: "Yes",
        },
      },
    },
  })
  assert.ok(job)
  assert.equal(job!.externalId, "usajobs:VA:10005678")
  assert.equal(job!.title, "Registered Nurse")
  assert.equal(job!.applyUrl, "https://www.usajobs.gov/job/10005678/apply")
  assert.equal(job!.location, "Denver, Colorado")
  assert.equal(job!.salaryMin, 80_000)
  assert.equal(job!.salaryMax, 120_000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.employmentType, "Full-time")
  assert.equal(job!.workMode, "hybrid")
  assert.equal(job!.postedAt, "2026-05-10T00:00:00.000Z")
  assert.match(job!.description ?? "", /Provide patient care/)
})

test("usajobs: mapItemToJob picks RemoteIndicator=true over TeleworkEligible", () => {
  const job = mapItemToJob("DOE", {
    MatchedObjectId: "20001234",
    MatchedObjectDescriptor: {
      PositionTitle: "Energy Analyst",
      PositionURI: "https://www.usajobs.gov/job/20001234",
      ApplyURI: ["https://www.usajobs.gov/job/20001234/apply"],
      UserArea: { Details: { RemoteIndicator: "true", TeleworkEligible: "Yes" } },
    },
  })
  assert.ok(job)
  assert.equal(job!.workMode, "remote")
})

test("usajobs: mapItemToJob returns null for items missing title/apply/id", () => {
  assert.equal(mapItemToJob("VA", { MatchedObjectId: "1" }), null)
  assert.equal(mapItemToJob("VA", { MatchedObjectDescriptor: { PositionTitle: "x" } }), null)
})

test("usajobs: fetchJobs surfaces auth error when env vars missing", async () => {
  const prev = { key: process.env.USAJOBS_API_KEY, ua: process.env.USAJOBS_USER_AGENT }
  delete process.env.USAJOBS_API_KEY
  delete process.env.USAJOBS_USER_AGENT
  try {
    await assert.rejects(
      usajobsAdapter.fetchJobs({
        slug: "VA",
        ctx: { etag: null, lastModified: null },
      }),
      /USAJOBS_API_KEY/
    )
  } finally {
    if (prev.key) process.env.USAJOBS_API_KEY = prev.key
    if (prev.ua) process.env.USAJOBS_USER_AGENT = prev.ua
  }
})

test("usajobs: fetchJobs paginates until SearchResultCountAll is satisfied", async () => {
  process.env.USAJOBS_API_KEY = "test-key"
  process.env.USAJOBS_USER_AGENT = "test@example.com"

  // Page 1: 500 jobs (full page → continues)
  // Page 2: 1 job
  // Total: 501
  const page1Items = Array.from({ length: 500 }, (_, i) => ({
    MatchedObjectId: `id-${i + 1}`,
    MatchedObjectDescriptor: {
      PositionTitle: `Job ${i + 1}`,
      ApplyURI: [`https://www.usajobs.gov/job/${i + 1}`],
    },
  }))
  const page2Items = [
    {
      MatchedObjectId: "id-501",
      MatchedObjectDescriptor: {
        PositionTitle: "Job 501",
        ApplyURI: ["https://www.usajobs.gov/job/501"],
      },
    },
  ]

  const fetchImpl: typeof fetch = async (input, init) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    const page = url.searchParams.get("Page")
    const body =
      page === "1"
        ? { SearchResult: { SearchResultCount: 500, SearchResultCountAll: 501, SearchResultItems: page1Items } }
        : { SearchResult: { SearchResultCount: 1, SearchResultCountAll: 501, SearchResultItems: page2Items } }
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    })
  }

  const result = await usajobsAdapter.fetchJobs({
    slug: "VA",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "usajobs")
  assert.equal(result.sourceAtsSlug, "VA")
  assert.equal(result.jobs.length, 501)
  assert.equal(result.jobs[0]?.externalId, "usajobs:VA:id-1")
  assert.equal(result.jobs[500]?.externalId, "usajobs:VA:id-501")
})
