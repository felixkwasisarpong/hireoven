import { strict as assert } from "node:assert"
import { test } from "node:test"
import { leverAdapter } from "./lever"

test("lever: detectFromUrl resolves a jobs.lever.co URL", () => {
  assert.deepEqual(leverAdapter.detectFromUrl("https://jobs.lever.co/anduril"), { slug: "anduril" })
})

test("lever: detectFromUrl ignores trailing path segments", () => {
  assert.deepEqual(
    leverAdapter.detectFromUrl("https://jobs.lever.co/anduril/some-role-id"),
    { slug: "anduril" }
  )
})

test("lever: detectFromUrl returns null for non-Lever hosts", () => {
  assert.equal(leverAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

test("lever: detectFromUrl returns null when slug is missing or malformed", () => {
  assert.equal(leverAdapter.detectFromUrl("https://jobs.lever.co/"), null)
  assert.equal(leverAdapter.detectFromUrl("https://jobs.lever.co/!!"), null)
})

test("lever: prefers rich HTML description over short descriptionPlain", async () => {
  const result = await leverAdapter.fetchJobs({
    slug: "ibility",
    ctx: {
      etag: null,
      lastModified: null,
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            {
              id: "d628175f-1f71-47b0-817c-b3ea55154c2c",
              text: "Junior Communications Product Specialist",
              hostedUrl: "https://jobs.lever.co/ibility/d628175f-1f71-47b0-817c-b3ea55154c2c",
              descriptionPlain:
                "Founded in early 2021, Ibility is a Service-Disabled Veteran-Owned Small Business.",
              description: `
                <div>Founded in early 2021, Ibility is a Service-Disabled Veteran-Owned Small Business.</div>
                <div><p><strong>Position Overview:</strong></p>
                <p>The Communications Products Specialist is a full-time position supporting a federal public health program.</p>
                <p><strong>Key Responsibilities:</strong></p>
                <ul>
                  <li>Develop healthcare-related promotional and educational materials.</li>
                  <li>Create digital assets including graphics, infographics, and data visualizations.</li>
                </ul>
                <p><strong>Qualifications Required:</strong></p>
                <ul><li>Bachelor's degree in Communications, Public Health, Marketing, Graphic Design, English, or a closely related field.</li></ul></div>
              `,
              lists: [],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
    },
  })

  assert.equal(result.jobs.length, 1)
  const description = result.jobs[0]?.description ?? ""
  assert.match(description, /Position Overview/i)
  assert.match(description, /federal public health program/i)
  assert.match(description, /healthcare-related promotional/i)
  assert.match(description, /Bachelor's degree/i)
  assert.ok(description.length > 300)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_LEVER_SLUG ?? "anduril"
const LIVE_LATENCY_BUDGET_MS = Number.parseInt(
  process.env.HARVESTER_LIVE_LATENCY_BUDGET_MS ?? "5000",
  10
)

test(
  "lever: live fetch returns a shaped response within latency budget",
  { skip: !LIVE },
  async () => {
    const startedAt = Date.now()
    let result
    try {
      result = await leverAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      const status = (error as { status?: number | null }).status
      if (status === 404) {
        // Company is no longer on Lever — skip rather than fail.
        return
      }
      throw error
    }
    const elapsed = Date.now() - startedAt

    assert.equal(result.sourceAts, "lever")
    assert.equal(result.sourceAtsSlug, LIVE_SLUG)
    assert.equal(result.notModified, false)
    assert.ok(Array.isArray(result.jobs))
    assert.ok(
      elapsed < LIVE_LATENCY_BUDGET_MS,
      `fetch took ${elapsed}ms, budget ${LIVE_LATENCY_BUDGET_MS}ms`
    )

    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^lever:.+/)
      assert.ok(sample.title.length > 0)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
