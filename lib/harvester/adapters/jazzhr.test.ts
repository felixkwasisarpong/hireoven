import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extractJobs, jazzhrAdapter } from "./jazzhr"

function htmlResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => html,
  } as unknown as Response
}

const SAMPLE_BOARD_HTML = `
<html><body>
  <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
  <ul>
    <li><a href="/apply/4ajHWUFtxf/Sales-Account-Executive">Sales Account Executive</a></li>
    <li><a href="/apply/DA4ZqViFPw/Senior-Platform-Engineer">Senior Platform Engineer</a></li>
    <li><a href="/apply/4ajHWUFtxf/Sales-Account-Executive">dup link</a></li>
  </ul>
  <script src="/apply/jobs.js?6.61.4"></script>
  <script src="/apply/submit-resume.js?6.61.4"></script>
  <a href="/apply/confirm/">Confirm</a>
</body></html>`

test("jazzhr: extractJobs parses /apply/{code}/{title} links and skips assets/dups", () => {
  const jobs = extractJobs("acme", SAMPLE_BOARD_HTML)
  assert.equal(jobs.length, 2)
  const sales = jobs.find((j) => j.externalId === "jazzhr:acme:4ajHWUFtxf")
  assert.ok(sales)
  assert.equal(sales!.title, "Sales Account Executive")
  assert.equal(
    sales!.applyUrl,
    "https://acme.applytojob.com/apply/4ajHWUFtxf/Sales-Account-Executive"
  )
  assert.match(sales!.contentHash, /^[0-9a-f]{32}$/)
  assert.ok(jobs.some((j) => j.title === "Senior Platform Engineer"))
})

test("jazzhr: fetchJobs maps board HTML into jobs", async () => {
  const fetchImpl = (async () => htmlResponse(SAMPLE_BOARD_HTML)) as unknown as typeof fetch
  const result = await jazzhrAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "jazzhr")
  assert.equal(result.jobs.length, 2)
})

test("jazzhr: detectFromUrl resolves a {slug}.applytojob.com URL", () => {
  assert.deepEqual(jazzhrAdapter.detectFromUrl("https://acme.applytojob.com/"), {
    slug: "acme",
  })
})

test("jazzhr: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(jazzhrAdapter.detectFromUrl("https://www.applytojob.com/"), null)
})

test("jazzhr: detectFromUrl rejects non-JazzHR hosts", () => {
  assert.equal(jazzhrAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_JAZZHR_SLUG ?? "jazzhr"

test(
  "jazzhr: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await jazzhrAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "jazzhr")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^jazzhr:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
