import { strict as assert } from "node:assert"
import { test } from "node:test"

// Constrain the adapter before it is (dynamically) imported: one area, no delay.
process.env.HARVESTER_WALMART_AREAS = "Technology"
process.env.HARVESTER_WALMART_MAX_PAGES_PER_AREA = "50"
process.env.HARVESTER_WALMART_PAGE_DELAY_MS = "0"

const load = () => import("./walmart")

function makeFetch(total: number, onCall?: (page: number) => void): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const page = body.variables.chatRequest.context.job_search_context.job_page as number
    onCall?.(page)
    const start = page * 10
    const jobs = []
    for (let i = start; i < Math.min(start + 10, total); i += 1) {
      jobs.push({
        job_id: `R-${i}`,
        title: `Data Scientist ${i}`,
        city: "BENTONVILLE",
        state: "AR",
        minPay: 100000,
        maxPay: 150000,
        employmentTypes: ["Full time"],
        jobPostingStartDate: 1783036800000,
      })
    }
    return new Response(
      JSON.stringify({ data: { jobSearchAssistant: { tool_messages: [{ artifact: { total_jobs: total, jobs } }] } } }),
      { headers: { "content-type": "application/json" } }
    )
  }) as unknown as typeof fetch
}

test("walmart: detectFromUrl matches careers.walmart.com only", async () => {
  const { walmartAdapter } = await load()
  assert.deepEqual(walmartAdapter.detectFromUrl("https://careers.walmart.com/us/en/results"), { slug: "walmart" })
  assert.equal(walmartAdapter.detectFromUrl("https://walmart.wd5.myworkdayjobs.com/x"), null)
  assert.equal(walmartAdapter.detectFromUrl("https://careers.target.com/"), null)
})

test("walmart: mapJob maps id, title, apply URL, pay, location", async () => {
  const { mapJob } = await load()
  const job = mapJob({
    job_id: "R-2503829",
    title: "Senior Manager, Advanced Analytics",
    city: "SAN BRUNO",
    state: "CA",
    minPay: 117000,
    maxPay: 234000,
    employmentTypes: ["Full time"],
    jobPostingStartDate: 1779062400000,
  })
  assert.ok(job)
  assert.equal(job!.externalId, "walmart:R-2503829")
  assert.equal(job!.title, "Senior Manager, Advanced Analytics")
  assert.equal(job!.applyUrl, "https://careers.walmart.com/us/en/job/R-2503829")
  assert.equal(job!.location, "SAN BRUNO, CA")
  assert.equal(job!.salaryMin, 117000)
  assert.equal(job!.salaryMax, 234000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, new Date(1779062400000).toISOString())
})

test("walmart: mapJob falls back to jobPostingTitle, returns null without id/title", async () => {
  const { mapJob } = await load()
  assert.equal(mapJob({ job_id: "R-1", title: "", jobPostingTitle: "Cashier" })!.title, "Cashier")
  assert.equal(mapJob({ title: "no id" }), null)
  assert.equal(mapJob({ job_id: "R-2" }), null)
})

test("walmart: fetchJobs paginates job_page and stops at total", async () => {
  const { walmartAdapter } = await load()
  const pages: number[] = []
  const result = await walmartAdapter.fetchJobs({
    slug: "walmart",
    ctx: { etag: null, lastModified: null, fetchImpl: makeFetch(25, (p) => pages.push(p)) },
  })
  assert.equal(result.sourceAts, "walmart")
  assert.equal(result.jobs.length, 25)
  assert.deepEqual(pages, [0, 1, 2]) // 25 jobs / 10 → pages 0,1,2 then stop
  assert.equal(result.jobs[0]?.externalId, "walmart:R-0")
  assert.equal(result.jobs[24]?.externalId, "walmart:R-24")
})

test("walmart: fetchJobs throws when the first request errors", async () => {
  const { walmartAdapter } = await load()
  const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch
  await assert.rejects(
    walmartAdapter.fetchJobs({ slug: "walmart", ctx: { etag: null, lastModified: null, fetchImpl } }),
    /walmart fetch failed/
  )
})
