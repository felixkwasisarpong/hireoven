import { strict as assert } from "node:assert"
import { test } from "node:test"
import { cornerstoneAdapter, mapRawJob, parseSlug } from "./cornerstone"

test("cornerstone: detectFromUrl parses slug + site_id from a canonical careers URL", () => {
  assert.deepEqual(
    cornerstoneAdapter.detectFromUrl(
      "https://henkel.csod.com/ux/ats/careersite/4/home?c=henkel"
    ),
    { slug: "henkel:4" }
  )
})

test("cornerstone: detectFromUrl defaults site_id to 1 when absent from the path", () => {
  assert.deepEqual(
    cornerstoneAdapter.detectFromUrl("https://aak.csod.com/?c=aak"),
    { slug: "aak:1" }
  )
})

test("cornerstone: detectFromUrl prefers the ?c= tenant param over the subdomain", () => {
  assert.deepEqual(
    cornerstoneAdapter.detectFromUrl(
      "https://sub.csod.com/ux/ats/careersite/1/home?c=realtenant"
    ),
    { slug: "realtenant:1" }
  )
})

test("cornerstone: detectFromUrl returns null for non-CSOD and reserved hosts", () => {
  assert.equal(cornerstoneAdapter.detectFromUrl("https://boards.greenhouse.io/x"), null)
  assert.equal(cornerstoneAdapter.detectFromUrl("https://www.csod.com/careersite/1/home"), null)
  assert.equal(cornerstoneAdapter.detectFromUrl("not a url"), null)
})

test("cornerstone: slug round-trips through detectFromUrl → parseSlug", () => {
  const detected = cornerstoneAdapter.detectFromUrl(
    "https://acdtalent.csod.com/ux/ats/careersite/3/home?c=acdtalent"
  )
  assert.ok(detected)
  const parsed = parseSlug(detected.slug)
  assert.deepEqual(parsed, { slug: "acdtalent", siteId: 3 })
})

test("cornerstone: parseSlug rejects malformed slugs", () => {
  assert.equal(parseSlug("nosite"), null)
  assert.equal(parseSlug("slug:0"), null)
  assert.equal(parseSlug("slug:abc"), null)
  assert.equal(parseSlug(":1"), null)
})

test("cornerstone: mapRawJob maps fields, namespaces id, cleans description", () => {
  const job = mapRawJob(
    { slug: "henkel", siteId: 4 },
    {
      requisitionId: "REQ-9001",
      displayJobTitle: "  Staff Engineer  ",
      externalDescription: "<p>Build <b>things</b>.</p>",
      locations: [{ city: "Berlin", state: "BE", country: "Germany" }],
      schedule: "Full-Time",
      postingEffectiveDate: "5/6/2026",
    }
  )
  assert.ok(job)
  assert.equal(job.externalId, "cornerstone:henkel:REQ-9001")
  assert.equal(job.title, "Staff Engineer")
  assert.equal(
    job.applyUrl,
    "https://henkel.csod.com/ux/ats/careersite/4/job/REQ-9001?c=henkel"
  )
  assert.equal(job.description, "Build things .")
  assert.equal(job.location, "Berlin, BE, Germany")
  assert.equal(job.employmentType, "full-time")
  assert.match(job.postedAt ?? "", /^2026-05-06T/)
  assert.match(job.contentHash, /^[0-9a-f]{32}$/)
})

test("cornerstone: mapRawJob drops placeholder descriptions and rows missing id/title", () => {
  const placeholder = mapRawJob(
    { slug: "aak", siteId: 1 },
    {
      requisitionId: "R1",
      displayJobTitle: "Analyst",
      externalDescription: "Please upload the job description",
    }
  )
  assert.ok(placeholder)
  assert.equal(placeholder.description, undefined)

  assert.equal(
    mapRawJob({ slug: "aak", siteId: 1 }, { displayJobTitle: "No Id" }),
    null
  )
  assert.equal(
    mapRawJob({ slug: "aak", siteId: 1 }, { requisitionId: "R2" }),
    null
  )
})

test("cornerstone: fetchJobs discovers host + token, paginates, and maps", async () => {
  const careerHtml = `<html><head><script>
    window.csod = window.csod || {};
    csod.context.token = "jwt-abc-123";
    var apiRoot = "https://eu-fra.api.csod.com/rec-job-search";
  </script></head><body>Careers</body></html>`

  const pages: Record<number, unknown> = {
    1: {
      data: {
        totalCount: 3,
        requisitions: [
          {
            requisitionId: "R100",
            displayJobTitle: "Engineer I",
            locations: [{ city: "Stockholm", country: "Sweden" }],
            schedule: "Full-Time",
            postingEffectiveDate: "2026-06-01",
            externalDescription: "<p>Do engineering.</p>",
          },
          {
            requisitionId: "R101",
            displayJobTitle: "Engineer II",
            locations: [{ name: "Remote - EU" }],
            schedule: "Part-Time",
          },
        ],
      },
    },
    2: {
      data: {
        totalCount: 3,
        requisitions: [
          {
            requisitionId: "R102",
            displayJobTitle: "Engineer III",
            locations: ["London, UK"],
          },
          // missing id → skipped
          { displayJobTitle: "Ghost" },
        ],
      },
    },
  }

  const calls: string[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`)
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { pageNumber: number }
      assert.equal(
        url,
        "https://eu-fra.api.csod.com/rec-job-search/external/jobs",
        "POST must go to the discovered EU host"
      )
      const headers = init.headers as Record<string, string>
      assert.equal(headers.authorization, "Bearer jwt-abc-123")
      return new Response(JSON.stringify(pages[body.pageNumber] ?? { data: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    // career-site HTML fetch
    return new Response(careerHtml, {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }) as unknown as typeof fetch

  const result = await cornerstoneAdapter.fetchJobs({
    slug: "aswatsoneurope:1",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.sourceAts, "cornerstone")
  assert.equal(result.sourceAtsSlug, "aswatsoneurope:1")
  assert.equal(result.notModified, false)
  // First call GET (init), then two POST pages.
  assert.equal(calls[0].startsWith("GET "), true)
  assert.equal(calls.filter((c) => c.startsWith("POST ")).length, 2)

  // 3 valid requisitions across 2 pages; the id-less "Ghost" row is dropped.
  assert.equal(result.jobs.length, 3)
  const ids = result.jobs.map((j) => j.externalId).sort()
  assert.deepEqual(ids, [
    "cornerstone:aswatsoneurope:R100",
    "cornerstone:aswatsoneurope:R101",
    "cornerstone:aswatsoneurope:R102",
  ])

  const first = result.jobs.find((j) => j.externalId.endsWith("R100"))!
  assert.equal(first.title, "Engineer I")
  assert.equal(first.location, "Stockholm, Sweden")
  assert.equal(first.employmentType, "full-time")
  assert.equal(first.description, "Do engineering.")
  assert.match(first.postedAt ?? "", /^2026-06-01T/)
  assert.equal(
    first.applyUrl,
    "https://aswatsoneurope.csod.com/ux/ats/careersite/1/job/R100?c=aswatsoneurope"
  )

  const remote = result.jobs.find((j) => j.externalId.endsWith("R101"))!
  assert.equal(remote.location, "Remote - EU")
  assert.equal(remote.employmentType, "part-time")
})

test("cornerstone: fetchJobs falls back to na host when none embedded, throws on first-page error", async () => {
  // No API host in the HTML → default na.api.csod.com. First POST fails → throw.
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      assert.match(url, /^https:\/\/na\.api\.csod\.com\//)
      return new Response("nope", { status: 500 })
    }
    return new Response(`<script>csod.context.token = "tok";</script>`, {
      status: 200,
      headers: { "content-type": "text/html" },
    })
  }) as unknown as typeof fetch

  await assert.rejects(
    cornerstoneAdapter.fetchJobs({
      slug: "aak:1",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /cornerstone fetch failed/
  )
})

test("cornerstone: fetchJobs throws when slug is malformed", async () => {
  await assert.rejects(
    cornerstoneAdapter.fetchJobs({
      slug: "not-a-valid-slug",
      ctx: { etag: null, lastModified: null },
    }),
    /invalid slug/
  )
})
