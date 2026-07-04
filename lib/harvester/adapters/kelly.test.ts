import { strict as assert } from "node:assert"
import { test } from "node:test"
import { kellyAdapter, mapJob, parseJobs } from "./kelly"

// Build a FacetWP <data> element carrying URL-encoded, single-item-array JSON.
function dataEl(fields: Record<string, string>) {
  const obj: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(fields)) obj[k] = [encodeURIComponent(v)]
  return `<data ${encodeURIComponent(JSON.stringify(obj))}></data>`
}

const template = (n: number, page: number) =>
  Array.from({ length: n }, (_, i) =>
    dataEl({
      job_id: String(10000 + (page - 1) * n + i), // unique per page
      job_title: `Recruiter ${(page - 1) * n + i}`,
      _job_location: "Denver, CO",
      description: "<p>Recruit people.</p>",
      employment_type: "Temporary",
      published_date: "2026-03-20",
      remote_yesno: "no",
    })
  ).join("\n")

function makeFetch(totalPages: number, onPage?: (p: number) => void): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const paged: number = body.data.paged
    onPage?.(paged)
    return new Response(
      JSON.stringify({ settings: { pager: { total_pages: totalPages, total_rows: totalPages * 2 } }, template: template(2, paged) }),
      { headers: { "content-type": "application/json" } }
    )
  }) as unknown as typeof fetch
}

test("kelly: detectFromUrl matches mykelly.com only", () => {
  assert.deepEqual(kellyAdapter.detectFromUrl("https://www.mykelly.com/job-search/"), { slug: "kelly" })
  assert.equal(kellyAdapter.detectFromUrl("https://careers.kellyocg.com/search"), null)
})

test("kelly: parseJobs decodes <data> elements into field maps", () => {
  const jobs = parseJobs(template(3, 1))
  assert.equal(jobs.length, 3)
  assert.equal(jobs[0].job_title, "Recruiter 0")
  assert.equal(jobs[0]._job_location, "Denver, CO")
})

test("kelly: mapJob builds id, title, apply URL, location, strips HTML", () => {
  const j = mapJob({
    job_id: "10123946",
    job_title: "Warehouse Associate",
    _job_location: "Dallas, TX",
    description: "<p>Do things.</p>",
    employment_type: "Temp to Hire",
    published_date: "2026-03-20",
    remote_yesno: "no",
  })
  assert.ok(j)
  assert.equal(j!.externalId, "kelly:10123946")
  assert.equal(j!.title, "Warehouse Associate")
  assert.equal(j!.applyUrl, "https://www.mykelly.com/job/10123946-warehouse-associate-dallas-tx/")
  assert.equal(j!.location, "Dallas, TX")
  assert.equal(j!.employmentType, "Temp to Hire")
  assert.equal(j!.description, "Do things.")
})

test("kelly: mapJob prefers a wp-href apply URL and flags remote", () => {
  const j = mapJob({ job_id: "1", job_title: "X", "wp-href": "https://www.mykelly.com/job/1-x/", remote_yesno: "yes" })
  assert.equal(j!.applyUrl, "https://www.mykelly.com/job/1-x/")
  assert.equal(j!.workMode, "Remote")
})

test("kelly: fetchJobs paginates up to total_pages", async () => {
  const pages: number[] = []
  const result = await kellyAdapter.fetchJobs({
    slug: "kelly",
    ctx: { etag: null, lastModified: null, fetchImpl: makeFetch(3, (p) => pages.push(p)) },
  })
  assert.equal(result.sourceAts, "kelly")
  assert.deepEqual(pages, [1, 2, 3]) // total_pages from page 1 drives the loop
  assert.equal(result.jobs.length, 6) // 3 pages × 2 jobs
})

test("kelly: fetchJobs throws when the first request errors", async () => {
  const fetchImpl = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch
  await assert.rejects(
    kellyAdapter.fetchJobs({ slug: "kelly", ctx: { etag: null, lastModified: null, fetchImpl } }),
    /kelly fetch failed/
  )
})
