import { strict as assert } from "node:assert"
import { test } from "node:test"
import { ibmAdapter, mapHit } from "./ibm"

function hit(jobId: string, title: string, loc: string) {
  return {
    _id: `hash-${jobId}`,
    _source: {
      title,
      url: `https://careers.ibm.com/careers/JobDetail?jobId=${jobId}`,
      description: "<p>Do <b>great</b> things.</p>",
      field_keyword_17: "Hybrid",
      field_keyword_18: "Professional",
      field_keyword_19: loc,
    },
  }
}

// Serves an ES-shaped response with `total` and a page of hits keyed by `from`.
function makeFetch(total: number, onFrom?: (from: number) => void): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const from: number = body.from
    onFrom?.(from)
    const size: number = body.size
    const hits = []
    for (let i = from; i < Math.min(from + size, total); i += 1) hits.push(hit(String(1000 + i), `Engineer ${i}`, "Austin, US"))
    return new Response(JSON.stringify({ hits: { total: { value: total }, hits } }), {
      headers: { "content-type": "application/json" },
    })
  }) as unknown as typeof fetch
}

test("ibm: detectFromUrl matches ibm.com/careers and careers.ibm.com", () => {
  assert.deepEqual(ibmAdapter.detectFromUrl("https://www.ibm.com/careers/search"), { slug: "ibm" })
  assert.deepEqual(ibmAdapter.detectFromUrl("https://careers.ibm.com/careers/JobDetail?jobId=1"), { slug: "ibm" })
  assert.equal(ibmAdapter.detectFromUrl("https://careers.example.com"), null)
})

test("ibm: mapHit maps id from jobId, apply URL, location, strips HTML desc", () => {
  const job = mapHit(hit("108263", "Quantum Hardware Design Engineer", "Yorktown Heights, US"))
  assert.ok(job)
  assert.equal(job!.externalId, "ibm:108263")
  assert.equal(job!.title, "Quantum Hardware Design Engineer")
  assert.equal(job!.applyUrl, "https://careers.ibm.com/careers/JobDetail?jobId=108263")
  assert.equal(job!.location, "Yorktown Heights, US")
  assert.equal(job!.workMode, "Hybrid")
  assert.equal(job!.description, "Do great things.")
})

test("ibm: mapHit returns null without source/title/url", () => {
  assert.equal(mapHit({ _id: "x" }), null)
  assert.equal(mapHit({ _source: { title: "no url" } }), null)
})

test("ibm: fetchJobs paginates via from and stops at total", async () => {
  const froms: number[] = []
  const result = await ibmAdapter.fetchJobs({
    slug: "ibm",
    ctx: { etag: null, lastModified: null, fetchImpl: makeFetch(250, (f) => froms.push(f)) },
  })
  assert.equal(result.sourceAts, "ibm")
  assert.equal(result.jobs.length, 250)
  assert.deepEqual(froms, [0, 100, 200]) // 250 total, size 100
  assert.equal(result.jobs[0]?.externalId, "ibm:1000")
})

test("ibm: fetchJobs throws when the first request errors", async () => {
  const fetchImpl = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch
  await assert.rejects(
    ibmAdapter.fetchJobs({ slug: "ibm", ctx: { etag: null, lastModified: null, fetchImpl } }),
    /ibm fetch failed/
  )
})
