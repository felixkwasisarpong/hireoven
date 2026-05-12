import { strict as assert } from "node:assert"
import { test } from "node:test"
import { personioAdapter } from "./personio"

test("personio: detectFromUrl resolves a {slug}.jobs.personio.com URL", () => {
  assert.deepEqual(
    personioAdapter.detectFromUrl("https://acme.jobs.personio.com/"),
    { slug: "acme" }
  )
})

test("personio: detectFromUrl supports .de domain", () => {
  assert.deepEqual(
    personioAdapter.detectFromUrl("https://acme.jobs.personio.de/"),
    { slug: "acme" }
  )
})

test("personio: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(personioAdapter.detectFromUrl("https://www.jobs.personio.com/"), null)
})

test("personio: detectFromUrl rejects non-Personio hosts", () => {
  assert.equal(personioAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

test("personio: parses an XML feed with multiple positions and CDATA descriptions", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>12345</id>
    <name><![CDATA[Senior Software Engineer]]></name>
    <office><![CDATA[Munich]]></office>
    <department><![CDATA[Engineering]]></department>
    <createdAt>2026-05-01T10:00:00Z</createdAt>
    <schedule>full-time</schedule>
    <employmentType><![CDATA[permanent]]></employmentType>
    <jobDescriptions>
      <jobDescription>
        <name><![CDATA[Your mission]]></name>
        <value><![CDATA[<p>Build great <b>things</b>.</p>]]></value>
      </jobDescription>
      <jobDescription>
        <name><![CDATA[About you]]></name>
        <value><![CDATA[5+ years experience.]]></value>
      </jobDescription>
    </jobDescriptions>
  </position>
  <position>
    <id>67890</id>
    <name>Product Manager</name>
    <office>Remote</office>
    <createdAt>2026-05-02T10:00:00Z</createdAt>
    <schedule>full-time</schedule>
  </position>
</workzag-jobs>`

  const fakeFetch = (async () =>
    ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => xml,
    }) as unknown as Response) as unknown as typeof fetch

  const result = await personioAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl: fakeFetch },
  })

  assert.equal(result.jobs.length, 2)
  assert.equal(result.jobs[0].externalId, "personio:12345")
  assert.equal(result.jobs[0].title, "Senior Software Engineer")
  assert.equal(result.jobs[0].location, "Munich")
  assert.equal(result.jobs[0].employmentType, "permanent")
  assert.ok(result.jobs[0].description?.includes("Build great"))
  assert.ok(result.jobs[0].description?.includes("5+ years"))
  assert.equal(result.jobs[0].applyUrl, "https://acme.jobs.personio.com/job/12345")
  assert.equal(result.jobs[1].title, "Product Manager")
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_PERSONIO_SLUG ?? "personio"

test(
  "personio: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await personioAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "personio")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^personio:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
