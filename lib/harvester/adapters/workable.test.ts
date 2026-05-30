import { strict as assert } from "node:assert"
import { test } from "node:test"
import { workableAdapter } from "./workable"
import type { HarvestCtx } from "./_base"

test("workable: detectFromUrl resolves an apply.workable.com URL", () => {
  assert.deepEqual(
    workableAdapter.detectFromUrl("https://apply.workable.com/loomly/"),
    { slug: "loomly" }
  )
})

test("workable: detectFromUrl strips trailing path segments", () => {
  assert.deepEqual(
    workableAdapter.detectFromUrl("https://apply.workable.com/loomly/j/ABC123"),
    { slug: "loomly" }
  )
})

test("workable: detectFromUrl returns null for non-Workable hosts", () => {
  assert.equal(workableAdapter.detectFromUrl("https://boards.greenhouse.io/stripe"), null)
})

test("workable: detectFromUrl returns null when slug is missing or malformed", () => {
  assert.equal(workableAdapter.detectFromUrl("https://apply.workable.com/"), null)
  assert.equal(workableAdapter.detectFromUrl("https://apply.workable.com/!!"), null)
})

function fakeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

test("workable: POSTs the jobs API and follows the nextPage token", async () => {
  const calls: Array<{ method?: string; body?: string }> = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push({ method: init.method, body: init.body as string })
    if (calls.length === 1) {
      return fakeJsonResponse({
        total: 2,
        results: [{ id: "1", title: "Engineer", shortcode: "AAA", city: "Austin", region: "TX", country: "United States" }],
        nextPage: "TOK2",
      })
    }
    return fakeJsonResponse({
      total: 2,
      results: [{ id: "2", title: "Product Manager", shortcode: "BBB", city: "Remote" }],
      nextPage: null,
    })
  }) as unknown as HarvestCtx["fetchImpl"]

  const result = await workableAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(calls.length, 2, "should fetch two pages")
  assert.equal(calls[0].method, "POST")
  assert.equal(calls[0].body, "{}", "page 1 sends an empty body")
  assert.equal(calls[1].method, "POST")
  assert.deepEqual(JSON.parse(calls[1].body ?? "{}"), { token: "TOK2" }, "page 2 carries the token")
  assert.equal(result.jobs.length, 2)
  assert.equal(result.notModified, false)
  assert.match(result.jobs[0].externalId, /^workable:/)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_WORKABLE_SLUG ?? "loomly"
const LIVE_LATENCY_BUDGET_MS = Number.parseInt(
  process.env.HARVESTER_LIVE_LATENCY_BUDGET_MS ?? "10000",
  10
)

test(
  "workable: live fetch returns a shaped response within latency budget",
  { skip: !LIVE },
  async () => {
    const startedAt = Date.now()
    let result
    try {
      result = await workableAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      const status = (error as { status?: number | null }).status
      if (status === 404) return
      throw error
    }
    const elapsed = Date.now() - startedAt

    assert.equal(result.sourceAts, "workable")
    assert.equal(result.sourceAtsSlug, LIVE_SLUG)
    assert.equal(result.notModified, false)
    assert.ok(Array.isArray(result.jobs))
    assert.ok(
      elapsed < LIVE_LATENCY_BUDGET_MS,
      `fetch took ${elapsed}ms, budget ${LIVE_LATENCY_BUDGET_MS}ms`
    )

    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^workable:.+/)
      assert.ok(sample.title.length > 0)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
