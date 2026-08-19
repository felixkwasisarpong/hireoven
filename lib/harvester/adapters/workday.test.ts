import { strict as assert } from "node:assert"
import { test } from "node:test"
import { fetchWorkdayJobDetail, workdayAdapter } from "./workday"

test("workday: detectFromUrl parses tenant/wd/site from a canonical Workday URL", () => {
  assert.deepEqual(
    workdayAdapter.detectFromUrl(
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite"
    ),
    { slug: "nvidia:wd5:NVIDIAExternalCareerSite" }
  )
})

test("workday: detectFromUrl handles URLs without an explicit locale segment", () => {
  assert.deepEqual(
    workdayAdapter.detectFromUrl("https://acme.wd1.myworkdayjobs.com/External"),
    { slug: "acme:wd1:External" }
  )
})

test("workday: detectFromUrl handles paths with extra segments past the site", () => {
  assert.deepEqual(
    workdayAdapter.detectFromUrl(
      "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Some-Location/Some-Title_R12345"
    ),
    { slug: "nvidia:wd5:NVIDIAExternalCareerSite" }
  )
})

test("workday: detectFromUrl handles three-digit wd hosts", () => {
  assert.deepEqual(
    workdayAdapter.detectFromUrl("https://acme.wd103.myworkdayjobs.com/External"),
    { slug: "acme:wd103:External" }
  )
})

test("workday: detectFromUrl and fetchJobs accept an underscore in the tenant", () => {
  // Real tenant found live: Sallie Mae's Workday tenant is "sallie_mae" on
  // both the subdomain and the cxs API path (confirmed directly against the
  // live API) — every crawl attempt 422'd for months because "_" wasn't in
  // the allowed tenant character set, even though Workday's own platform
  // accepts it fine.
  assert.deepEqual(
    workdayAdapter.detectFromUrl("https://sallie_mae.wd5.myworkdayjobs.com/en-US/Careers"),
    { slug: "sallie_mae:wd5:Careers" }
  )
})

test("workday: detectFromUrl returns null for non-Workday hosts", () => {
  assert.equal(workdayAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

test("workday: detectFromUrl returns null when the site segment is missing", () => {
  assert.equal(workdayAdapter.detectFromUrl("https://nvidia.wd5.myworkdayjobs.com/en-US/"), null)
  assert.equal(workdayAdapter.detectFromUrl("https://nvidia.wd5.myworkdayjobs.com/"), null)
})

test("workday: detectFromUrl rejects malformed hosts", () => {
  assert.equal(
    workdayAdapter.detectFromUrl("https://nvidia.myworkdayjobs.com/External"),
    null
  )
  assert.equal(workdayAdapter.detectFromUrl("https://nvidia.wd.myworkdayjobs.com/External"), null)
})

test("workday: fetchJobs accepts an underscore-tenant slug and hits the underscore host", async () => {
  let calledUrl = ""
  const fetchImpl = (async (url: string) => {
    calledUrl = url
    return new Response(JSON.stringify({ total: 0, jobPostings: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch

  const result = await workdayAdapter.fetchJobs({
    slug: "sallie_mae:wd5:Careers",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.jobs.length, 0)
  assert.match(calledUrl, /^https:\/\/sallie_mae\.wd5\.myworkdayjobs\.com\/wday\/cxs\/sallie_mae\/Careers\/jobs$/)
})

test("workday: fetchJobs throws when slug is malformed", async () => {
  await assert.rejects(
    workdayAdapter.fetchJobs({
      slug: "not-a-valid-workday-slug",
      ctx: { etag: null, lastModified: null },
    }),
    /invalid slug/
  )
})

test("workday: fetchWorkdayJobDetail preserves section and bullet structure", async () => {
  const fetchImpl = (async () =>
    new Response(
      JSON.stringify({
        jobPostingInfo: {
          jobDescription: `
            Software Engineer<p><b>Company:</b></p>Acme Corp
            <p>We support multiple programs, including:</p>
            <ul><li><p>E-3 variants</p></li><li><p>UK E-7</p></li></ul>
            <p><b>Position Responsibilities:</b></p>
            <ul><li><p>Designs simulation models</p></li><li><p>Partners with stakeholders</p></li></ul>
            <p><b>Basic Qualifications:</b></p>
            <ul><li><p>2&#43; years of software development experience</p></li></ul>
          `,
          jobRequisitionLocation: {
            descriptor: "Oklahoma City, OK",
            country: { descriptor: "United States" },
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    )) as typeof fetch

  const detail = await fetchWorkdayJobDetail(
    { tenant: "acme", wd: "wd1", site: "External" },
    "/job/Oklahoma-City/Software-Engineer_R123",
    { etag: null, lastModified: null, fetchImpl }
  )

  assert.ok(detail?.description)
  assert.match(detail.description, /Company:\nAcme Corp/)
  assert.match(detail.description, /We support multiple programs, including:\n- E-3 variants\n- UK E-7/)
  assert.match(detail.description, /Position Responsibilities:\n- Designs simulation models\n- Partners with stakeholders/)
  assert.match(detail.description, /Basic Qualifications:\n- 2\+ years/)
  assert.doesNotMatch(detail.description, /<p|&#43;/)
  assert.equal(detail.location, "Oklahoma City, OK, United States")
})

test("workday: subdivides a capped tenant by facet to break the 2,000 cap", async () => {
  // Regression guard: Workday caps a query's reported total at 2,000 and wraps
  // pagination past it. A capped query must be subdivided by facet, or the board
  // silently truncates at ~1-2k jobs. Mock reports the base query at the cap with
  // a jobFamilyGroup facet; each facet child reports a small, fully-paginable set.
  const makePostings = (prefix: string, offset: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      externalPath: `/job/${prefix}-${offset + i}`,
      title: `${prefix} Job ${offset + i}`,
    }))

  const fetchImpl = (async (_url: string, init: { body?: string; method?: string }) => {
    // Detail GETs have no body — return an empty detail payload (no-op enrich).
    if (!init?.body) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    const body = JSON.parse(init.body) as {
      offset?: number
      appliedFacets?: { jobFamilyGroup?: string[] }
    }
    const offset = body.offset ?? 0
    const jfg = body.appliedFacets?.jobFamilyGroup?.[0]

    let total: number
    let prefix: string
    if (!jfg) {
      total = 2000 // the cap → must subdivide
      prefix = "base"
    } else if (jfg === "eng") {
      total = 40
      prefix = "eng"
    } else {
      total = 25
      prefix = "sales"
    }
    const pageCount = Math.min(20, Math.max(0, total - offset))
    const payload = {
      total,
      jobPostings: makePostings(prefix, offset, pageCount),
      facets: jfg
        ? []
        : [
            {
              facetParameter: "jobFamilyGroup",
              values: [
                { id: "eng", count: 40 },
                { id: "sales", count: 25 },
              ],
            },
          ],
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch

  const result = await workdayAdapter.fetchJobs({
    slug: "acme:wd1:External",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  // base page-0 (20) + eng (40) + sales (25) = 85 unique jobs — unreachable
  // without subdivision (a single capped query yields at most its own pages).
  assert.equal(result.jobs.length, 85)
  const ids = result.jobs.map((j) => j.externalId)
  assert.ok(ids.some((id) => id.includes("eng")), "expected eng-facet jobs")
  assert.ok(ids.some((id) => id.includes("sales")), "expected sales-facet jobs")
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG =
  process.env.HARVESTER_LIVE_WORKDAY_SLUG ?? "nvidia:wd5:NVIDIAExternalCareerSite"
// Workday is meaningfully slower than the other 5: paginated POSTs to a
// per-tenant host, ~1.5s/page for 50 jobs. A fully-loaded tenant (~800 jobs)
// can take 30-60s. The contract being tested is shape, not throughput.
const LIVE_LATENCY_BUDGET_MS = Number.parseInt(
  process.env.HARVESTER_LIVE_LATENCY_BUDGET_MS ?? "60000",
  10
)

test(
  "workday: live fetch returns a shaped response within latency budget",
  { skip: !LIVE },
  async () => {
    const startedAt = Date.now()
    let result
    try {
      result = await workdayAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      const status = (error as { status?: number | null }).status
      if (status === 404) return
      throw error
    }
    const elapsed = Date.now() - startedAt

    assert.equal(result.sourceAts, "workday")
    assert.equal(result.sourceAtsSlug, LIVE_SLUG)
    assert.equal(result.notModified, false)
    assert.ok(Array.isArray(result.jobs))
    assert.ok(
      elapsed < LIVE_LATENCY_BUDGET_MS,
      `fetch took ${elapsed}ms, budget ${LIVE_LATENCY_BUDGET_MS}ms`
    )

    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^workday:.+/)
      assert.ok(sample.title.length > 0)
      assert.match(sample.applyUrl, /^https:\/\/.+\.myworkdayjobs\.com\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)

test("workday: change-detection returns notModified + skips crawl on unchanged board", async () => {
  const makePostings = (offset: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({ externalPath: `/job/base-${offset + i}`, title: `Job ${offset + i}` }))
  let listingPosts = 0
  const fetchImpl = (async (_url: string, init: { body?: string }) => {
    if (!init?.body) return new Response("{}", { status: 200, headers: { "content-type": "application/json" } }) // detail GET
    listingPosts += 1
    const offset = (JSON.parse(init.body) as { offset?: number }).offset ?? 0
    const total = 30 // below QUERY_TOTAL_CAP → skip is trustworthy
    const pageCount = Math.min(20, Math.max(0, total - offset))
    return new Response(JSON.stringify({ total, jobPostings: makePostings(offset, pageCount), facets: [] }),
      { status: 200, headers: { "content-type": "application/json" } })
  }) as unknown as typeof fetch

  const first = await workdayAdapter.fetchJobs({ slug: "acme:wd1:External", ctx: { etag: null, lastModified: null, fetchImpl } })
  assert.equal(first.notModified, false)
  assert.equal(first.jobs.length, 30)
  assert.ok(first.etag && first.etag.startsWith("wdv1:"), "stores a page-0 fingerprint as etag")
  const afterFirst = listingPosts

  const second = await workdayAdapter.fetchJobs({ slug: "acme:wd1:External", ctx: { etag: first.etag, lastModified: null, fetchImpl } })
  assert.equal(second.notModified, true, "unchanged board short-circuits")
  assert.equal(second.jobs.length, 0)
  assert.equal(second.etag, first.etag)
  assert.equal(listingPosts - afterFirst, 1, "second crawl does exactly one page-0 probe POST, no pagination")
})

test("workday: detectFromUrl normalises the myworkdaysite host onto the same slug", () => {
  // wd5.myworkdaysite.com/recruiting/<tenant>/<site> is Workday's other careers
  // host — the tenant sits in the path rather than the subdomain. It serves the
  // same board as <tenant>.wd5.myworkdayjobs.com/<site> (verified live for
  // Sysco: identical CXS payload), so it maps onto the existing slug instead of
  // getting its own, keeping one company record per board.
  assert.deepEqual(
    workdayAdapter.detectFromUrl("https://wd5.myworkdaysite.com/recruiting/sysco/syscocareers"),
    { slug: "sysco:wd5:syscocareers" }
  )
  assert.deepEqual(
    workdayAdapter.detectFromUrl("https://wd5.myworkdaysite.com/en-US/recruiting/sysco/syscocareers"),
    { slug: "sysco:wd5:syscocareers" }
  )
  assert.deepEqual(
    workdayAdapter.detectFromUrl("https://wd103.myworkdaysite.com/recruiting/acme/External"),
    { slug: "acme:wd103:External" }
  )
})

test("workday: detectFromUrl rejects malformed myworkdaysite paths", () => {
  // Without the /recruiting/ segment the tenant is unknown; guessing it would
  // point every CXS call at the wrong board.
  assert.equal(workdayAdapter.detectFromUrl("https://wd5.myworkdaysite.com/sysco/syscocareers"), null)
  assert.equal(workdayAdapter.detectFromUrl("https://wd5.myworkdaysite.com/recruiting/sysco"), null)
  assert.equal(workdayAdapter.detectFromUrl("https://wd5.myworkdaysite.com/"), null)
})
