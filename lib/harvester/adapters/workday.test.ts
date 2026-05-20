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
