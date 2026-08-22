import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  CUSTOM_HOST_PREFIX,
  decodeSlug,
  encodeSlug,
  encodeCustomSlug,
  extractOracleDetailDescriptionFromHtml,
  mapRequisitionToJob,
  oraclecloudAdapter,
  parsePod,
} from "./oraclecloud"

test("oraclecloud: detectFromUrl extracts pod + site from Candidate Experience URL", () => {
  assert.deepEqual(
    oraclecloudAdapter.detectFromUrl(
      "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/"
    ),
    { slug: "eeho.fa.us2:CX_1" }
  )
})

test("oraclecloud: detectFromUrl accepts deep job-detail URLs", () => {
  assert.deepEqual(
    oraclecloudAdapter.detectFromUrl(
      "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12345/"
    ),
    { slug: "eeho.fa.us2:CX_1" }
  )
})

test("oraclecloud: detectFromUrl rejects marketing subdomains + non-CE paths", () => {
  assert.equal(oraclecloudAdapter.detectFromUrl("https://www.oraclecloud.com/cloud"), null)
  assert.equal(
    oraclecloudAdapter.detectFromUrl("https://docs.oraclecloud.com/something/sites/foo"),
    null
  )
  assert.equal(
    oraclecloudAdapter.detectFromUrl("https://eeho.fa.us2.oraclecloud.com/somewhere-else/"),
    null
  )
})

test("oraclecloud: parsePod accepts multi-dot pods, rejects marketing hosts", () => {
  assert.equal(parsePod("eeho.fa.us2.oraclecloud.com"), "eeho.fa.us2")
  assert.equal(parsePod("acme-prod.oraclecloud.com"), "acme-prod")
  assert.equal(parsePod("www.oraclecloud.com"), null)
  assert.equal(parsePod("blogs.oraclecloud.com"), null)
})

test("oraclecloud: slug encode / decode round-trips for multi-dot pods", () => {
  const slug = encodeSlug("eeho.fa.us2", "CX_1")
  assert.equal(slug, "eeho.fa.us2:CX_1")
  const decoded = decodeSlug(slug)
  assert.deepEqual(decoded, { identifier: "eeho.fa.us2", site: "CX_1", origin: "https://eeho.fa.us2.oraclecloud.com" })
  assert.equal(decodeSlug("eeho.fa.us2"), null)
  assert.equal(decodeSlug("eeho.fa.us2:bad site"), null)
})

test("oraclecloud: custom-domain slug encode / decode round-trips", () => {
  const slug = encodeCustomSlug("careers.autozone.com", "jobsearch")
  assert.equal(slug, `${CUSTOM_HOST_PREFIX}careers.autozone.com:jobsearch`)
  const decoded = decodeSlug(slug)
  assert.deepEqual(decoded, { identifier: "careers.autozone.com", site: "jobsearch", origin: "https://careers.autozone.com" })
})

test("oraclecloud: detectFromUrl detects custom-domain Oracle CE portals", () => {
  assert.deepEqual(
    oraclecloudAdapter.detectFromUrl("https://careers.autozone.com/en/sites/jobsearch/job/101159"),
    { slug: `${CUSTOM_HOST_PREFIX}careers.autozone.com:jobsearch` }
  )
  assert.deepEqual(
    oraclecloudAdapter.detectFromUrl("https://www.macysjobs.com/en/sites/jobsearch/job/REQ_773680"),
    { slug: `${CUSTOM_HOST_PREFIX}www.macysjobs.com:jobsearch` }
  )
  // hcmUI prefix is also a valid CE marker (no /job/ segment required)
  assert.deepEqual(
    oraclecloudAdapter.detectFromUrl(
      "https://careers.autozone.com/hcmUI/CandidateExperience/en/sites/jobsearch/"
    ),
    { slug: `${CUSTOM_HOST_PREFIX}careers.autozone.com:jobsearch` }
  )
})

test("oraclecloud: detectFromUrl rejects non-Oracle `/sites/{slug}` URLs (Forbes, Bloomberg, etc.)", () => {
  // Forbes contributor pages: forbes.com/sites/{author}/...
  assert.equal(
    oraclecloudAdapter.detectFromUrl("https://www.forbes.com/sites/emmylucas/2026/05/27/example"),
    null
  )
  // Bloomberg-style /sites/{section}
  assert.equal(
    oraclecloudAdapter.detectFromUrl("https://www.bloomberg.com/sites/something/article"),
    null
  )
})

test("oraclecloud: mapRequisitionToJob produces a HarvestedJob with location + description", () => {
  const job = mapRequisitionToJob(
    {
      Id: 12345,
      Title: "Senior Database Engineer",
      PostedDate: "2026-05-10T00:00:00Z",
      ExternalDescriptionStr: "<p>Maintain core systems.</p>",
      ExternalResponsibilitiesStr: "<ul><li>Operate prod</li></ul>",
      PrimaryLocation: "Austin, TX",
      WorkplaceTypeCode: "FULL_TIME_REMOTE",
      workLocation: { Name: "Austin", StateProvince: "TX", CountryName: "United States" },
    },
    "eeho.fa.us2",
    "CX_1",
    "https://eeho.fa.us2.oraclecloud.com"
  )
  assert.ok(job)
  assert.equal(job!.externalId, "oraclecloud:eeho.fa.us2:CX_1:12345")
  assert.equal(job!.title, "Senior Database Engineer")
  assert.equal(job!.location, "Austin, TX")
  assert.equal(job!.workMode, "remote")
  assert.equal(job!.postedAt, "2026-05-10T00:00:00.000Z")
  assert.match(job!.description ?? "", /Maintain core systems\./)
  assert.match(job!.description ?? "", /Operate prod/)
  assert.equal(
    job!.applyUrl,
    "https://eeho.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/12345"
  )
})

test("oraclecloud: mapRequisitionToJob skips records missing title or id", () => {
  assert.equal(mapRequisitionToJob({ Id: 1 }, "x", "S", "https://x.oraclecloud.com"), null)
  assert.equal(mapRequisitionToJob({ Title: "No ID" }, "x", "S", "https://x.oraclecloud.com"), null)
})

test("oraclecloud: extracts detail description from meta tags", () => {
  const html = `
    <html>
      <head>
        <meta property="og:title" content="Medical Courier"/>
        <meta property="og:description" content="Medical Courier - Oklahoma City, OK Drive health forward &mdash; with a career that goes the distance. At Quest Diagnostics, your deliveries don&rsquo;t just move packages, they move healthcare forward. Join a trusted team of professionals ensuring life-saving diagnostics reach patients quickly and safely. This detail text is long enough to be useful for matching and normalization."/>
      </head>
    </html>
  `

  const description = extractOracleDetailDescriptionFromHtml(html)

  assert.ok(description)
  assert.match(description, /Drive health forward - with a career/)
  assert.match(description, /deliveries don't just move packages/)
})

test("oraclecloud: fetchJobs paginates by TotalJobsCount, ignoring the misleading outer hasMore", async () => {
  // Regression: Oracle's top-level `hasMore` describes the singleton OUTER
  // envelope (always false), NOT the inner requisitionList. Trusting it
  // truncated every multi-page tenant to the first page. Both pages here carry
  // hasMore:false, but TotalJobsCount=3 — the adapter must still fetch page 1.
  const page0 = {
    items: [
      {
        TotalJobsCount: 3,
        requisitionList: [
          {
            Id: 1,
            Title: "Job One",
            ExternalDescriptionStr: "<p>One</p>",
            PrimaryLocation: "Remote",
            WorkplaceTypeCode: "REMOTE",
          },
          {
            Id: 2,
            Title: "Job Two",
            PrimaryLocation: "NYC",
          },
        ],
      },
    ],
    hasMore: false,
  }
  const page1 = {
    items: [
      {
        TotalJobsCount: 3,
        requisitionList: [
          {
            Id: 3,
            Title: "Job Three",
            PrimaryLocation: "SF, CA",
          },
        ],
      },
    ],
    hasMore: false,
  }

  let listingCalls = 0
  let detailCalls = 0
  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    if (url.pathname === "/hcmRestApi/resources/latest/recruitingCEJobRequisitions") {
      listingCalls += 1
      const finder = url.searchParams.get("finder") ?? ""
      const offsetMatch = finder.match(/offset=(\d+)/)
      const offset = offsetMatch ? Number.parseInt(offsetMatch[1], 10) : -1
      if (offset === 0) return new Response(JSON.stringify(page0), { headers: { "content-type": "application/json" } })
      if (offset === 200) return new Response(JSON.stringify(page1), { headers: { "content-type": "application/json" } })
    }
    if (url.pathname.includes("/hcmUI/CandidateExperience/en/sites/CX_1/job/")) {
      detailCalls += 1
      const id = url.pathname.split("/").pop()
      return new Response(
        `<meta property="og:description" content="Job ${id} detail description with enough useful responsibilities, qualifications, schedule information, and role context to pass the minimum text threshold for harvesting before persistence. This should be stored during the harvest tick instead of waiting for enrichment."/>`,
        { headers: { "content-type": "text/html" } }
      )
    }
    return new Response("{}", { headers: { "content-type": "application/json" } })
  }

  const result = await oraclecloudAdapter.fetchJobs({
    slug: "eeho.fa.us2:CX_1",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(listingCalls, 2, "should paginate to page 1 via TotalJobsCount despite outer hasMore=false, then stop once all 3 are collected")
  assert.equal(detailCalls, 3, "should detail-fetch jobs with missing or too-short listing descriptions")
  assert.equal(result.sourceAts, "oraclecloud")
  assert.equal(result.sourceAtsSlug, "eeho.fa.us2:CX_1")
  assert.equal(result.jobs.length, 3)
  const ids = result.jobs.map((j) => j.externalId).sort()
  assert.deepEqual(ids, [
    "oraclecloud:eeho.fa.us2:CX_1:1",
    "oraclecloud:eeho.fa.us2:CX_1:2",
    "oraclecloud:eeho.fa.us2:CX_1:3",
  ])
  const remoteJob = result.jobs.find((j) => j.externalId.endsWith(":1"))
  assert.equal(remoteJob!.workMode, "remote")
  const detailedJob = result.jobs.find((j) => j.externalId.endsWith(":2"))
  assert.match(detailedJob!.description ?? "", /detail description with enough useful/)
})

test("oraclecloud: change-detection returns notModified + skips pagination on unchanged board", async () => {
  const page0 = {
    items: [
      {
        TotalJobsCount: 2,
        requisitionList: [
          { Id: 1, Title: "Alpha", PrimaryLocation: "NYC", ExternalDescriptionStr: "<p>Responsibilities include building and operating large scale distributed systems, collaborating across teams, mentoring engineers, and ensuring reliability, security and performance of critical production services every single day here.</p>" },
          { Id: 2, Title: "Beta", PrimaryLocation: "SF", ExternalDescriptionStr: "<p>Responsibilities include building and operating large scale distributed systems, collaborating across teams, mentoring engineers, and ensuring reliability, security and performance of critical production services every single day here.</p>" },
        ],
      },
    ],
  }
  let listingCalls = 0
  const fetchImpl: typeof fetch = (async (input: string | URL) => {
    const url = new URL(input.toString())
    if (url.pathname === "/hcmRestApi/resources/latest/recruitingCEJobRequisitions") {
      listingCalls += 1
      return new Response(JSON.stringify(page0), { headers: { "content-type": "application/json" } })
    }
    return new Response("{}", { headers: { "content-type": "application/json" } })
  }) as unknown as typeof fetch

  const first = await oraclecloudAdapter.fetchJobs({ slug: "eeho.fa.us2:CX_1", ctx: { etag: null, lastModified: null, fetchImpl } })
  assert.equal(first.notModified, false)
  assert.equal(first.jobs.length, 2)
  assert.ok(first.etag && first.etag.startsWith("orcv1:"), "stores a page-0 fingerprint as etag")
  const afterFirst = listingCalls

  const second = await oraclecloudAdapter.fetchJobs({ slug: "eeho.fa.us2:CX_1", ctx: { etag: first.etag, lastModified: null, fetchImpl } })
  assert.equal(second.notModified, true, "unchanged board short-circuits")
  assert.equal(second.jobs.length, 0)
  assert.equal(second.etag, first.etag)
  assert.equal(listingCalls - afterFirst, 1, "second crawl does exactly one page-0 fetch, no pagination")
})

test("oraclecloud: block structure survives into the description", () => {
  // stripHtml inserted a newline for every block boundary and then ran
  // `\s+ -> " "`, which collapsed all of them straight back. 95% of Oracle
  // descriptions reached the job page as one unbroken paragraph.
  const job = mapRequisitionToJob(
    {
      Id: 777,
      Title: "Platform Engineer",
      ExternalDescriptionStr:
        "<p>Own the deployment platform.</p><p>Responsibilities:</p>" +
        "<ul><li>Run Kubernetes clusters</li><li>Own CI/CD pipelines</li></ul>" +
        "First line<br>Second line<br/>Third line",
      PrimaryLocation: "Austin, TX",
    },
    "eeho.fa.us2",
    "CX_1",
    "https://eeho.fa.us2.oraclecloud.com"
  )

  const description = job!.description ?? ""
  assert.ok(description.includes("\n"), `expected line breaks, got: ${JSON.stringify(description)}`)

  const lines = description.split("\n").map((l) => l.trim())
  assert.ok(lines.includes("Own the deployment platform."))
  assert.ok(lines.includes("Responsibilities:"))
  // <br> and <br /> are the forms Oracle actually emits; only </br> was matched.
  assert.ok(lines.includes("Second line"), `expected <br> to break lines, got: ${JSON.stringify(lines)}`)
  assert.ok(lines.includes("Third line"))
  // List items are recognisable as bullets rather than run together.
  assert.ok(
    lines.some((l) => l.startsWith("- ") && l.includes("Kubernetes")),
    `expected bulleted list items, got: ${JSON.stringify(lines)}`
  )
})
