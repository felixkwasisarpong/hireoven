import { strict as assert } from "node:assert"
import { test } from "node:test"
import { greenhouseAdapter } from "./greenhouse"

test("greenhouse: detectFromUrl resolves a boards.greenhouse.io URL", () => {
  const result = greenhouseAdapter.detectFromUrl("https://boards.greenhouse.io/stripe")
  assert.deepEqual(result, { slug: "stripe" })
})

test("greenhouse: detectFromUrl extracts slug from API path", () => {
  const result = greenhouseAdapter.detectFromUrl(
    "https://boards-api.greenhouse.io/v1/boards/stripe/jobs"
  )
  assert.deepEqual(result, { slug: "stripe" })
})

test("greenhouse: detectFromUrl returns null for non-Greenhouse host", () => {
  const result = greenhouseAdapter.detectFromUrl("https://jobs.lever.co/stripe")
  assert.equal(result, null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_GREENHOUSE_SLUG ?? "stripe"
const LIVE_LATENCY_BUDGET_MS = Number.parseInt(
  process.env.HARVESTER_LIVE_LATENCY_BUDGET_MS ?? "5000",
  10
)

test(
  "greenhouse: live fetch returns shaped jobs within latency budget",
  { skip: !LIVE },
  async () => {
    const startedAt = Date.now()
    const result = await greenhouseAdapter.fetchJobs({
      slug: LIVE_SLUG,
      ctx: { etag: null, lastModified: null },
    })
    const elapsed = Date.now() - startedAt

    assert.equal(result.sourceAts, "greenhouse")
    assert.equal(result.sourceAtsSlug, LIVE_SLUG)
    assert.equal(result.notModified, false, "fresh fetch must not be 304")
    assert.ok(result.jobs.length > 0, "expected at least one job on a public board")
    assert.ok(
      elapsed < LIVE_LATENCY_BUDGET_MS,
      `fetch took ${elapsed}ms, budget ${LIVE_LATENCY_BUDGET_MS}ms`
    )
    assert.ok(
      result.upstreamLatencyMs > 0 && result.upstreamLatencyMs <= elapsed,
      "upstreamLatencyMs should be a positive value bounded by total elapsed"
    )

    const sample = result.jobs[0]
    assert.match(sample.externalId, /^greenhouse:\d+$/)
    assert.ok(sample.title.length > 0)
    assert.match(sample.applyUrl, /^https?:\/\//)
    assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
  }
)

test(
  "greenhouse: conditional request returns 304 on unchanged ETag",
  { skip: !LIVE },
  async () => {
    const first = await greenhouseAdapter.fetchJobs({
      slug: LIVE_SLUG,
      ctx: { etag: null, lastModified: null },
    })
    if (!first.etag && !first.lastModified) {
      // Server didn't return either conditional header; skip silently.
      return
    }

    const second = await greenhouseAdapter.fetchJobs({
      slug: LIVE_SLUG,
      ctx: { etag: first.etag, lastModified: first.lastModified },
    })

    assert.equal(second.notModified, true, "expected 304 with matching conditional headers")
    assert.equal(second.jobs.length, 0)
  }
)
