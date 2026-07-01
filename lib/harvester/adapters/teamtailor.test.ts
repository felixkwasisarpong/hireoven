import { strict as assert } from "node:assert"
import { test } from "node:test"
import { teamtailorAdapter } from "./teamtailor"

test("teamtailor: detectFromUrl resolves a {slug}.teamtailor.com URL", () => {
  assert.deepEqual(
    teamtailorAdapter.detectFromUrl("https://acme.teamtailor.com/"),
    { slug: "acme" }
  )
})

test("teamtailor: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(teamtailorAdapter.detectFromUrl("https://www.teamtailor.com/"), null)
  assert.equal(teamtailorAdapter.detectFromUrl("https://app.teamtailor.com/"), null)
})

test("teamtailor: detectFromUrl rejects non-Teamtailor hosts", () => {
  assert.equal(teamtailorAdapter.detectFromUrl("https://jobs.lever.co/anduril"), null)
})

test("teamtailor: detectFromUrl rejects platform/infra subdomains", () => {
  for (const host of [
    "assets", "eu-render", "tt-parser-ecs", "auth-tests", "analytics-ro",
    "staging-assets", "insights-aws", "docs", "dashboard", "ext-na", "errors-wl",
    "finance-integrations", "web", "na", "au", "career2",
  ]) {
    assert.equal(
      teamtailorAdapter.detectFromUrl(`https://${host}.teamtailor.com/`),
      null,
      `${host} should be rejected`
    )
  }
})

test("teamtailor: detectFromUrl still accepts real customer boards", () => {
  for (const host of ["acme", "career", "normative", "spotify-jobs"]) {
    assert.deepEqual(
      teamtailorAdapter.detectFromUrl(`https://${host}.teamtailor.com/`),
      { slug: host }
    )
  }
})

test("teamtailor: parses the JSON Feed `items` shape (regression)", async () => {
  // Regression guard: /jobs.json is JSON Feed 1.1 — jobs live under `items`,
  // NOT `jobs`. The adapter previously read `.jobs` and silently returned zero
  // jobs on every board.
  const feed = {
    version: "https://jsonfeed.org/version/1.1",
    title: "Acme",
    items: [
      {
        id: "abc-123",
        title: "Staff Engineer",
        url: "https://acme.teamtailor.com/jobs/456-staff-engineer",
        date_published: "2026-06-26T14:21:12+02:00",
        content_html: "<p>Build <strong>things</strong>.</p>",
        _jobposting: {
          employmentType: "FULL_TIME",
          datePosted: "2026-06-26T14:21:12+02:00",
          jobLocation: [
            { address: { addressLocality: "Malmö", addressRegion: "Malmö", addressCountry: "SE" } },
          ],
        },
      },
    ],
  }
  const fetchImpl = (async () =>
    new Response(JSON.stringify(feed), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  const result = await teamtailorAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.jobs.length, 1)
  const job = result.jobs[0]
  assert.equal(job.externalId, "teamtailor:abc-123")
  assert.equal(job.title, "Staff Engineer")
  assert.equal(job.applyUrl, "https://acme.teamtailor.com/jobs/456-staff-engineer")
  assert.equal(job.employmentType, "FULL_TIME")
  assert.equal(job.location, "Malmö, SE") // locality+region de-duped, country kept
  assert.ok(job.description?.includes("Build things"))
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_TEAMTAILOR_SLUG ?? "teamtailor"

test(
  "teamtailor: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await teamtailorAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "teamtailor")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^teamtailor:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
