import { strict as assert } from "node:assert"
import { test } from "node:test"
import { pinpointAdapter } from "./pinpoint"

test("pinpoint: detectFromUrl resolves a {slug}.pinpointhq.com URL", () => {
  assert.deepEqual(
    pinpointAdapter.detectFromUrl("https://acme.pinpointhq.com/"),
    { slug: "acme" }
  )
})

test("pinpoint: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(pinpointAdapter.detectFromUrl("https://www.pinpointhq.com/"), null)
  assert.equal(pinpointAdapter.detectFromUrl("https://app.pinpointhq.com/"), null)
  assert.equal(pinpointAdapter.detectFromUrl("https://api.pinpointhq.com/"), null)
})

test("pinpoint: detectFromUrl rejects non-Pinpoint hosts", () => {
  assert.equal(pinpointAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

test("pinpoint: maps a realistic postings.json payload", async () => {
  const payload = {
    data: [
      {
        id: 12345,
        title: "Senior Software Engineer",
        url: "https://acme.pinpointhq.com/en/postings/abc-123",
        location: { city: "London", name: "London, UK", province: "England" },
        workplace_type: "hybrid",
        employment_type: "permanent_full_time",
        description: "<p>Build great <b>things</b>.</p>",
        first_published_at: "2026-05-01T10:00:00Z",
      },
      {
        id: "67890",
        title: "Marketing Intern",
        url: "https://acme.pinpointhq.com/en/postings/def-456",
        location: { city: "Austin", province: "TX" },
        workplace_type: "remote",
        employment_type: "internship",
      },
      // Skipped: missing url.
      { id: 999, title: "No URL Job" },
    ],
  }

  const fakeFetch = (async () =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    }) as unknown as Response) as unknown as typeof fetch

  const result = await pinpointAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl: fakeFetch },
  })

  assert.equal(result.sourceAts, "pinpoint")
  assert.equal(result.jobs.length, 2)

  const first = result.jobs[0]
  assert.equal(first.externalId, "pinpoint:12345")
  assert.equal(first.title, "Senior Software Engineer")
  assert.equal(first.applyUrl, "https://acme.pinpointhq.com/en/postings/abc-123")
  assert.equal(first.location, "London, UK")
  assert.equal(first.workMode, "hybrid")
  assert.equal(first.employmentType, "FULL_TIME")
  assert.equal(first.postedAt, "2026-05-01T10:00:00Z")
  assert.ok(first.description?.includes("Build great"))
  assert.match(first.contentHash, /^[0-9a-f]{32}$/)

  const second = result.jobs[1]
  assert.equal(second.externalId, "pinpoint:67890")
  assert.equal(second.location, "Austin, TX")
  assert.equal(second.workMode, "remote")
  assert.equal(second.employmentType, "INTERN")
})

test("pinpoint: guards a non-array data payload", async () => {
  const fakeFetch = (async () =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ data: null }),
    }) as unknown as Response) as unknown as typeof fetch

  const result = await pinpointAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl: fakeFetch },
  })

  assert.equal(result.notModified, false)
  assert.deepEqual(result.jobs, [])
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_PINPOINT_SLUG ?? "aawdc"

test(
  "pinpoint: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await pinpointAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "pinpoint")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^pinpoint:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
