import { strict as assert } from "node:assert"
import { test } from "node:test"
import { bamboohrAdapter } from "./bamboohr"

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response
}

test("bamboohr: maps /careers/list + /careers/{id}/detail JSON into jobs", async () => {
  const listBody = {
    meta: { totalCount: 2 },
    result: [
      {
        id: "724",
        jobOpeningName: "VP of Marketing",
        employmentStatusLabel: "Full-Time",
        atsLocation: { country: "Canada", state: "Ontario", city: "Toronto" },
        isRemote: true,
      },
      {
        id: "743",
        jobOpeningName: "Principal Engineer",
        employmentStatusLabel: "Full-Time",
        location: { city: "Mohali", state: "Punjab" },
      },
    ],
  }
  const detailBody = (id: string) => ({
    result: { jobOpening: { description: `<p>Role ${id} description text.</p>` } },
  })

  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith("/careers/list")) return jsonResponse(listBody)
    const m = url.match(/careers\/(\d+)\/detail/)
    if (m) return jsonResponse(detailBody(m[1]))
    throw new Error(`unexpected url ${url}`)
  }) as unknown as typeof fetch

  const result = await bamboohrAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.sourceAts, "bamboohr")
  assert.equal(result.jobs.length, 2)

  const vp = result.jobs.find((j) => j.title === "VP of Marketing")
  assert.ok(vp)
  assert.equal(vp!.externalId, "bamboohr:acme:724")
  assert.equal(vp!.applyUrl, "https://acme.bamboohr.com/careers/724")
  assert.equal(vp!.location, "Toronto, Ontario, Canada")
  assert.equal(vp!.employmentType, "Full-Time")
  assert.equal(vp!.workMode, "remote")
  assert.match(vp!.description ?? "", /description text/)
  assert.match(vp!.contentHash, /^[0-9a-f]{32}$/)

  const eng = result.jobs.find((j) => j.title === "Principal Engineer")
  assert.ok(eng)
  assert.equal(eng!.location, "Mohali, Punjab")
  assert.equal(eng!.workMode, undefined)
})

test("bamboohr: alreadyDescribedIds skips detail fetch but still lists the job", async () => {
  const listBody = {
    meta: { totalCount: 1 },
    result: [{ id: "9", jobOpeningName: "Already Known", employmentStatusLabel: "Full-Time" }],
  }
  let detailCalls = 0
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith("/careers/list")) return jsonResponse(listBody)
    detailCalls += 1
    return jsonResponse({ result: { jobOpening: { description: "<p>should be skipped</p>" } } })
  }) as unknown as typeof fetch

  const result = await bamboohrAdapter.fetchJobs({
    slug: "acme",
    ctx: {
      etag: null,
      lastModified: null,
      fetchImpl,
      alreadyDescribedIds: new Set(["bamboohr:acme:9"]),
    },
  })

  assert.equal(result.jobs.length, 1)
  assert.equal(result.jobs[0].description, undefined)
  assert.equal(detailCalls, 0)
})

test("bamboohr: detectFromUrl resolves a {slug}.bamboohr.com URL", () => {
  assert.deepEqual(bamboohrAdapter.detectFromUrl("https://acme.bamboohr.com/careers"), {
    slug: "acme",
  })
})

test("bamboohr: detectFromUrl rejects vendor subdomains", () => {
  assert.equal(bamboohrAdapter.detectFromUrl("https://www.bamboohr.com/"), null)
  assert.equal(bamboohrAdapter.detectFromUrl("https://app.bamboohr.com/"), null)
})

test("bamboohr: detectFromUrl rejects non-BambooHR hosts", () => {
  assert.equal(bamboohrAdapter.detectFromUrl("https://jobs.lever.co/anduril"), null)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_BAMBOOHR_SLUG ?? "bamboohr"

test(
  "bamboohr: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await bamboohrAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "bamboohr")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^bamboohr:.+/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)
