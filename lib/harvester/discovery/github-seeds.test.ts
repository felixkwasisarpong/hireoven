import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extractCandidates, fetchAndExtract } from "./github-seeds"

test("extractCandidates: pulls greenhouse + lever + ashby URLs from markdown", () => {
  const md = `
| Company | Link |
| --- | --- |
| Stripe | https://boards.greenhouse.io/stripe/jobs/12345 |
| Anduril | [Apply](https://jobs.lever.co/anduril/some-role-id) |
| Anthropic | https://jobs.ashbyhq.com/anthropic |
`
  const candidates = extractCandidates(md)
  const sorted = candidates.map((c) => `${c.atsType}:${c.slug}`).sort()
  assert.deepEqual(sorted, ["ashby:anthropic", "greenhouse:stripe", "lever:anduril"])
})

test("extractCandidates: dedupes same (atsType, slug) across many links", () => {
  const md = `
- https://boards.greenhouse.io/stripe/jobs/1
- https://boards.greenhouse.io/stripe/jobs/2
- https://boards.greenhouse.io/stripe
`
  const candidates = extractCandidates(md)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].atsType, "greenhouse")
  assert.equal(candidates[0].slug, "stripe")
  assert.equal(candidates[0].careersUrl, "https://boards.greenhouse.io/stripe")
})

test("extractCandidates: ignores non-ATS URLs", () => {
  const md = `
See https://example.com/jobs and https://github.com/SimplifyJobs/Summer2025-Internships
also https://www.linkedin.com/in/somebody
`
  const candidates = extractCandidates(md)
  assert.equal(candidates.length, 0)
})

test("extractCandidates: strips trailing punctuation from URLs", () => {
  const md = `Apply at (https://boards.greenhouse.io/stripe).`
  const candidates = extractCandidates(md)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].slug, "stripe")
})

test("extractCandidates: recognises workday tenant URLs", () => {
  const md = `https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Some-Title`
  const candidates = extractCandidates(md)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].atsType, "workday")
  assert.equal(candidates[0].slug, "nvidia:wd5:NVIDIAExternalCareerSite")
  assert.equal(
    candidates[0].careersUrl,
    "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite"
  )
})

test("fetchAndExtract: returns ok=false when fetch fails", async () => {
  const fakeFetch = (async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch
  const { candidates, summary } = await fetchAndExtract(
    { name: "test", url: "https://example.com/missing.md" },
    { fetchImpl: fakeFetch }
  )
  assert.equal(candidates.length, 0)
  assert.equal(summary.ok, false)
  assert.match(summary.error ?? "", /fetch failed/)
})

test("fetchAndExtract: parses returned text", async () => {
  const text = "https://boards.greenhouse.io/stripe\nhttps://jobs.lever.co/anduril\n"
  const fakeFetch = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => text,
    }) as unknown as Response) as unknown as typeof fetch
  const { candidates, summary } = await fetchAndExtract(
    { name: "test", url: "https://example.com/list.md" },
    { fetchImpl: fakeFetch }
  )
  assert.equal(candidates.length, 2)
  assert.equal(summary.ok, true)
  assert.equal(summary.bytesRead, text.length)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"

test(
  "fetchAndExtract: live SimplifyJobs README returns >0 ATS candidates",
  { skip: !LIVE },
  async () => {
    const { candidates, summary } = await fetchAndExtract({
      name: "SimplifyJobs/New-Grad-Positions",
      url: "https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/README.md",
    })
    if (!summary.ok) {
      // README path changed; the seed source's location moves over time.
      // Treat as a non-blocking warning rather than a test failure.
      console.warn(`[github-seeds] live source unavailable: ${summary.error}`)
      return
    }
    assert.ok(
      candidates.length > 0,
      `expected >0 ATS candidates in the README; got ${candidates.length}`
    )
  }
)
