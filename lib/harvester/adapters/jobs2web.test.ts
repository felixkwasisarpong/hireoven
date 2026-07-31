import { strict as assert } from "node:assert"
import { test } from "node:test"
import { jobs2webAdapter } from "./jobs2web"

const BASE = "https://careers.example.com"

function listingPage(jobs: Array<Record<string, unknown>>) {
  return new Response(JSON.stringify({ jobList: jobs }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function detailPage(descriptionHtml: string) {
  const html = `<html><body>
    <div class="jobColumnOne">
      <span xml:lang="en-US" itemprop="description" data-careersite-propertyid="description" class="rtltextaligneligible">
        ${descriptionHtml}
      </span>
    </div>
    <div class="jobColumnTwo">
      <div class="joblayouttoken">
        <span class="joblayouttoken-label">Location:</span>
        <span>Somewhere, US</span>
      </div>
    </div>
  </body></html>`
  return new Response(html, { status: 200, headers: { "content-type": "text/html" } })
}

test("jobs2web: detectFromUrl always returns null (enrolled by ats_type, like radancy)", () => {
  assert.equal(jobs2webAdapter.detectFromUrl("https://careers.example.com/job/x/1/"), null)
})

test("jobs2web: maps a listing page and fetches its description, skipping past the itemprop attribute string", async () => {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "POST" && url.includes("/services/jobs/search/")) {
      const body = JSON.parse(String(init.body))
      if (body.page === 0) {
        return listingPage([
          {
            id: 111,
            title: "Senior Software Engineer",
            urltitle: "San-Francisco-CA-Senior-Software-Engineer",
            city: "San Francisco",
            state: "CA",
            country: "US",
            referencedate: "2026-07-01T02:01:00Z[UTC]",
            shifttype: "Permanent",
          },
        ])
      }
      return listingPage([]) // page 1: no more results
    }
    if (url.includes("/job/San-Francisco-CA-Senior-Software-Engineer/111/")) {
      return detailPage("<p>Build great things at scale.</p><ul><li>Own services end to end</li></ul>")
    }
    throw new Error(`unexpected request: ${url}`)
  }) as unknown as typeof fetch

  const result = await jobs2webAdapter.fetchJobs({
    slug: BASE,
    ctx: { etag: null, lastModified: null, timeoutMs: 5_000, fetchImpl },
  })

  assert.equal(result.sourceAts, "jobs2web")
  assert.equal(result.jobs.length, 1)

  const job = result.jobs[0]
  assert.equal(job.externalId, "jobs2web:111")
  assert.equal(job.title, "Senior Software Engineer")
  assert.equal(job.applyUrl, `${BASE}/job/San-Francisco-CA-Senior-Software-Engineer/111/`)
  assert.equal(job.location, "San Francisco, CA")
  assert.equal(job.postedAt, new Date("2026-07-01T02:01:00Z").toISOString())
  assert.equal(job.employmentType, "fulltime")

  // Regression: the description must NOT contain the leaked attribute
  // string from the enclosing <span itemprop="description" ...> tag.
  assert.ok(!job.description?.includes("data-careersite-propertyid"))
  assert.ok(!job.description?.includes("rtltextaligneligible"))
  assert.ok(job.description?.includes("Build great things at scale."))
  assert.ok(job.description?.includes("Own services end to end"))
  // Must stop at the sidebar metadata column, not bleed into it.
  assert.ok(!job.description?.includes("Location:"))
})

test("jobs2web: pagination stops when a page returns fewer than RECORDS_PER_PAGE", async () => {
  let listCalls = 0
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    // Only the POST list endpoint is exercised here — every job ID below is
    // pre-marked "already described" so no detail (GET) fetch happens.
    listCalls += 1
    const body = JSON.parse(String(init?.body))
    if (body.page === 0) {
      return listingPage(
        Array.from({ length: 25 }, (_, i) => ({
          id: i + 1,
          title: `Job ${i + 1}`,
          urltitle: `job-${i + 1}`,
          city: "Remote",
        }))
      )
    }
    if (body.page === 1) {
      return listingPage([{ id: 999, title: "Last One", urltitle: "last-one", city: "Remote" }])
    }
    throw new Error("should not paginate past the short page")
  }) as unknown as typeof fetch

  const allIds = new Set([...Array.from({ length: 25 }, (_, i) => `jobs2web:${i + 1}`), "jobs2web:999"])

  const result = await jobs2webAdapter.fetchJobs({
    slug: BASE,
    ctx: {
      etag: null,
      lastModified: null,
      timeoutMs: 5_000,
      fetchImpl,
      alreadyDescribedIds: allIds, // skip all detail fetches for this test
    },
  })

  assert.equal(result.jobs.length, 26)
  assert.equal(listCalls, 2, "should fetch exactly 2 list pages, not a 3rd")
})

test("jobs2web: skips detail fetch for jobs already described", async () => {
  let detailFetches = 0
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body))
      if (body.page === 0) {
        return listingPage([
          { id: 1, title: "Already Described", urltitle: "already-described" },
          { id: 2, title: "Needs Description", urltitle: "needs-description" },
        ])
      }
      return listingPage([])
    }
    detailFetches += 1
    if (url.includes("needs-description")) return detailPage("<p>Fresh content.</p>")
    throw new Error(`unexpected detail fetch: ${url}`)
  }) as unknown as typeof fetch

  const result = await jobs2webAdapter.fetchJobs({
    slug: BASE,
    ctx: {
      etag: null,
      lastModified: null,
      timeoutMs: 5_000,
      fetchImpl,
      alreadyDescribedIds: new Set(["jobs2web:1"]),
    },
  })

  assert.equal(detailFetches, 1, "should only fetch the detail page for the job missing a description")
  const described = result.jobs.find((j) => j.externalId === "jobs2web:2")
  assert.ok(described?.description?.includes("Fresh content."))
})
