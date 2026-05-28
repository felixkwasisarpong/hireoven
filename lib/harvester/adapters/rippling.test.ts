import { strict as assert } from "node:assert"
import { test } from "node:test"
import { ripplingAdapter } from "./rippling"

// Minimal __NEXT_DATA__ listing payload
function makeListingHtml(slug: string, items: object[], total: number, page = 0): string {
  const nextData = {
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            {
              queryKey: ["board", slug, "job-posts", true, { page, pageSize: 100 }],
              state: {
                data: {
                  items,
                  totalItems: total,
                  totalPages: Math.ceil(total / 100),
                  page,
                  pageSize: 100,
                },
              },
            },
          ],
        },
      },
    },
  }
  return `<html><head></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`
}

function makeDetailHtml(jobPost: object): string {
  const nextData = {
    props: {
      pageProps: {
        apiData: {
          jobPost,
          payRangeDetails: [],
        },
      },
    },
  }
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`
}

const SAMPLE_ITEMS = [
  {
    id: "aaa-111",
    name: "Senior Engineer",
    url: "https://ats.rippling.com/acme/jobs/aaa-111",
    department: { name: "Engineering" },
    locations: [{ name: "San Francisco, CA", workplaceType: "HYBRID" }],
    language: "en-US",
  },
  {
    id: "bbb-222",
    name: "Product Designer",
    url: "https://ats.rippling.com/acme/jobs/bbb-222",
    department: { name: "Design" },
    locations: [{ name: "Remote", workplaceType: "REMOTE" }],
    language: "en-US",
  },
]

const SAMPLE_JOB_POST = {
  uuid: "aaa-111",
  name: "Senior Engineer",
  description: {
    company: "<p>We are Acme Corp.</p>",
    role: "<p>You will build amazing things.</p>",
  },
  workLocations: ["San Francisco, CA"],
  department: { name: "Engineering" },
  employmentType: { id: "Full-Time", label: "Full-Time" },
  createdOn: "2026-01-15T10:00:00.000Z",
  url: "https://ats.rippling.com/acme/jobs/aaa-111",
  companyName: "Acme Corp",
}

test("ripplingAdapter.detectFromUrl: matches ats.rippling.com job board", () => {
  assert.deepEqual(
    ripplingAdapter.detectFromUrl("https://ats.rippling.com/acme-corp/jobs"),
    { slug: "acme-corp" }
  )
  assert.deepEqual(
    ripplingAdapter.detectFromUrl("https://ats.rippling.com/ACME-Corp/jobs"),
    { slug: "acme-corp" }
  )
  assert.deepEqual(
    ripplingAdapter.detectFromUrl("https://ats.rippling.com/acme/jobs/aaa-111-bbb-222"),
    { slug: "acme" }
  )
})

test("ripplingAdapter.detectFromUrl: rejects non-rippling URLs", () => {
  assert.equal(ripplingAdapter.detectFromUrl("https://jobs.lever.co/acme"), null)
  assert.equal(ripplingAdapter.detectFromUrl("https://ats.rippling.com"), null)
  assert.equal(ripplingAdapter.detectFromUrl("https://ats.rippling.com/acme/apply"), null)
  assert.equal(ripplingAdapter.detectFromUrl("https://app.rippling.com/acme"), null)
})

test("ripplingAdapter.fetchJobs: extracts jobs from __NEXT_DATA__ listing", async () => {
  let detailCalls = 0
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes("/jobs/aaa-111")) {
      detailCalls++
      return new Response(makeDetailHtml(SAMPLE_JOB_POST), {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    }
    if (url.includes("/jobs/bbb-222")) {
      detailCalls++
      return new Response(
        makeDetailHtml({
          uuid: "bbb-222",
          name: "Product Designer",
          description: { company: "<p>Acme</p>", role: "<p>Design our product.</p>" },
          workLocations: ["Remote"],
          employmentType: { id: "Full-Time" },
          createdOn: "2026-02-01T10:00:00.000Z",
        }),
        { status: 200, headers: { "content-type": "text/html" } }
      )
    }
    // Listing page
    return new Response(makeListingHtml("acme", SAMPLE_ITEMS, 2), {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }

  const result = await ripplingAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl: fakeFetch },
  })

  assert.equal(result.sourceAts, "rippling")
  assert.equal(result.jobs.length, 2)
  assert.equal(result.notModified, false)

  const eng = result.jobs.find((j) => j.externalId === "rippling:acme:aaa-111")
  assert.ok(eng, "should find engineer job")
  assert.equal(eng!.title, "Senior Engineer")
  assert.equal(eng!.workMode, "hybrid")
  assert.match(eng!.description ?? "", /amazing things/)
  assert.match(eng!.description ?? "", /Acme Corp/)

  const design = result.jobs.find((j) => j.externalId === "rippling:acme:bbb-222")
  assert.ok(design, "should find designer job")
  assert.equal(design!.workMode, "remote")
  assert.match(design!.description ?? "", /Design our product/)

  assert.equal(detailCalls, 2)
})

test("ripplingAdapter.fetchJobs: paginates when totalItems > pageSize", async () => {
  const page0Items = [{ id: "j1", name: "Job 1", url: "https://ats.rippling.com/co/jobs/j1", locations: [] }]
  const page1Items = [{ id: "j2", name: "Job 2", url: "https://ats.rippling.com/co/jobs/j2", locations: [] }]
  let listingCalls = 0

  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.includes("/jobs/")) {
      // Detail pages — shallow
      return new Response("<html><body><script id='__NEXT_DATA__' type='application/json'>{\"props\":{\"pageProps\":{\"apiData\":{\"jobPost\":{\"uuid\":\"x\",\"name\":\"x\",\"description\":{\"company\":\"\",\"role\":\"A job description here with enough text to pass validation checks.\"}}},\"dehydratedState\":{\"queries\":[]}}}}</script></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    }
    const page = Number(url.searchParams.get("page") ?? "0")
    listingCalls++
    const items = page === 0 ? page0Items : page === 1 ? page1Items : []
    return new Response(makeListingHtml("co", items, 2, page), {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }

  // Force pageSize=1 per page by making total=2 but giving only 1 item per page
  // The adapter uses PAGE_SIZE=100, so with total=2 and page 0 giving 1 item,
  // covered (100) >= total (2) so it stops after page 0. Re-test with total=101.
  const result = await ripplingAdapter.fetchJobs({
    slug: "co",
    ctx: { etag: null, lastModified: null, fetchImpl: fakeFetch },
  })
  assert.equal(result.jobs.length, 1) // stops after page 0 since 100 >= 2
  assert.equal(listingCalls, 1)
})

test("ripplingAdapter.fetchJobs: throws when listing page 0 fails", async () => {
  const fakeFetch: typeof fetch = async () =>
    new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } })

  await assert.rejects(
    () =>
      ripplingAdapter.fetchJobs({
        slug: "acme",
        ctx: { etag: null, lastModified: null, fetchImpl: fakeFetch },
      }),
    /rippling fetch failed/
  )
})
