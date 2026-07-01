import { strict as assert } from "node:assert"
import { test } from "node:test"
import { recruiterboxAdapter } from "./recruiterbox"

test("recruiterbox: detectFromUrl resolves a {slug}.recruiterbox.com URL", () => {
  assert.deepEqual(
    recruiterboxAdapter.detectFromUrl("https://adgistics.recruiterbox.com/"),
    { slug: "adgistics" }
  )
})

test("recruiterbox: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(recruiterboxAdapter.detectFromUrl("https://www.recruiterbox.com/"), null)
  assert.equal(recruiterboxAdapter.detectFromUrl("https://app.recruiterbox.com/"), null)
  assert.equal(recruiterboxAdapter.detectFromUrl("https://jsapi.recruiterbox.com/"), null)
})

test("recruiterbox: detectFromUrl returns null for non-Recruiterbox hosts", () => {
  assert.equal(recruiterboxAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
  assert.equal(recruiterboxAdapter.detectFromUrl("https://hire.trakstar.com/jobs/abc"), null)
})

test("recruiterbox: fetchJobs paginates and maps a two-page response", async () => {
  const page0 = {
    meta: { offset: 0, limit: 100, total: 150 },
    objects: Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      title: `Role ${i + 1}`,
      hosted_url: `https://hire.trakstar.com/jobs/${i + 1}`,
      location: { city: "London", state: "", country: "UK" },
      allows_remote: i === 0,
      position_type: "full_time",
      created_on: "2026-06-01T00:00:00Z",
    })),
  }
  const page100 = {
    meta: { offset: 100, limit: 100, total: 150 },
    objects: Array.from({ length: 50 }, (_, i) => ({
      id: 101 + i,
      title: `Role ${101 + i}`,
      hosted_url: `https://hire.trakstar.com/jobs/${101 + i}`,
      location: { city: "Berlin", country: "Germany" },
    })),
  }

  const seenOffsets: string[] = []
  const fetchImpl = (async (url: string) => {
    const offset = new URL(url).searchParams.get("offset") ?? ""
    seenOffsets.push(offset)
    const body = offset === "0" ? page0 : page100
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch

  const result = await recruiterboxAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  // Exhausted both pages via offset += objects.length.
  assert.deepEqual(seenOffsets, ["0", "100"])
  assert.equal(result.sourceAts, "recruiterbox")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.notModified, false)
  assert.equal(result.jobs.length, 150)

  const first = result.jobs[0]
  assert.equal(first.externalId, "recruiterbox:1")
  assert.equal(first.title, "Role 1")
  assert.equal(first.applyUrl, "https://hire.trakstar.com/jobs/1")
  assert.equal(first.location, "London, UK")
  assert.equal(first.workMode, "remote")
  assert.equal(first.employmentType, "full_time")
  assert.match(first.contentHash, /^[0-9a-f]{32}$/)

  const second = result.jobs[1]
  assert.equal(second.workMode, undefined)

  const last = result.jobs[149]
  assert.equal(last.externalId, "recruiterbox:150")
  assert.equal(last.location, "Berlin, Germany")
})

test("recruiterbox: fetchJobs skips rows missing id/title/hosted_url", async () => {
  const body = {
    meta: { offset: 0, limit: 100, total: 3 },
    objects: [
      { id: 1, title: "Good", hosted_url: "https://hire.trakstar.com/jobs/1" },
      { id: 2, title: "No URL" },
      { title: "No id", hosted_url: "https://hire.trakstar.com/jobs/x" },
    ],
  }
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  const result = await recruiterboxAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0].externalId, "recruiterbox:1")
})

test("recruiterbox: fetchJobs handles a valid empty tenant (total=0)", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ meta: { offset: 0, limit: 100, total: 0 }, objects: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  const result = await recruiterboxAdapter.fetchJobs({
    slug: "empty",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.jobs.length, 0)
  assert.equal(result.notModified, false)
})

test("recruiterbox: fetchJobs throws with status on a first-page 400 (invalid client)", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ client_name: "Invalid client name" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  await assert.rejects(
    recruiterboxAdapter.fetchJobs({
      slug: "nope",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    (err: Error & { status?: number | null }) => {
      assert.match(err.message, /recruiterbox fetch failed/)
      assert.equal(err.status, 400)
      return true
    }
  )
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_RECRUITERBOX_SLUG ?? "adgistics"

test(
  "recruiterbox: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await recruiterboxAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      const status = (error as { status?: number | null }).status
      if (status === 400 || status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "recruiterbox")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^recruiterbox:.+/)
      assert.ok(sample.title.length > 0)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
