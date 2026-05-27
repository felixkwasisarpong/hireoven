import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  CUSTOM_HOST_PREFIX,
  decodeSlug,
  encodeSlug,
  encodeCustomSlug,
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

test("oraclecloud: fetchJobs paginates until hasMore=false", async () => {
  const page0 = {
    items: [
      {
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
    hasMore: true,
  }
  const page1 = {
    items: [
      {
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

  let calls = 0
  const fetchImpl: typeof fetch = async (input) => {
    calls += 1
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    assert.equal(url.pathname, "/hcmRestApi/resources/latest/recruitingCEJobRequisitions")
    const finder = url.searchParams.get("finder") ?? ""
    const offsetMatch = finder.match(/offset=(\d+)/)
    const offset = offsetMatch ? Number.parseInt(offsetMatch[1], 10) : -1
    if (offset === 0) return new Response(JSON.stringify(page0), { headers: { "content-type": "application/json" } })
    if (offset === 50) return new Response(JSON.stringify(page1), { headers: { "content-type": "application/json" } })
    return new Response("{}", { headers: { "content-type": "application/json" } })
  }

  const result = await oraclecloudAdapter.fetchJobs({
    slug: "eeho.fa.us2:CX_1",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(calls, 2, "should stop after hasMore=false")
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
})
