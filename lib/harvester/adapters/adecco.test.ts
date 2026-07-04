import { strict as assert } from "node:assert"
import { test } from "node:test"
import { adeccoAdapter, mapJob } from "./adecco"

function job(id: string, title: string, city: string) {
  return {
    jobId: id,
    jobTitle: title,
    cityName: city,
    stateName: "Connecticut",
    description: "<p>Assemble things.</p>",
    minsalary: 40000,
    maxsalary: 60000,
    salaryCurrency: "USD",
    employmentTypeTitle: "Contract/Temporary",
    postedDate: "2026-03-20T00:00:00Z",
    applyUri: "",
  }
}

// Serves a page of jobs keyed by the `range` offset in the request body.
function makeFetch(total: number, onRange?: (range: number) => void): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    const range: number = body.range
    onRange?.(range)
    const jobs = []
    for (let i = range; i < Math.min(range + 10, total); i += 1) jobs.push(job(`US_${1000 + i}`, `Assembler ${i}`, "Southington"))
    return new Response(JSON.stringify({ jobs }), { headers: { "content-type": "application/json" } })
  }) as unknown as typeof fetch
}

test("adecco: detectFromUrl matches adecco.com only", () => {
  assert.deepEqual(adeccoAdapter.detectFromUrl("https://www.adecco.com/en-us/job-search"), { slug: "adecco" })
  assert.equal(adeccoAdapter.detectFromUrl("https://www.adeccousa.com/jobs"), null)
})

test("adecco: mapJob maps id, title, salary, location, apply URL fallback", () => {
  const j = mapJob(job("US_EN_99_027153_2565440", "Assembler", "Southington"))
  assert.ok(j)
  assert.equal(j!.externalId, "adecco:US_EN_99_027153_2565440")
  assert.equal(j!.title, "Assembler")
  // empty applyUri → canonical job-details fallback
  assert.equal(j!.applyUrl, "https://www.adecco.com/en-us/job-details/US_EN_99_027153_2565440")
  assert.equal(j!.location, "Southington, Connecticut")
  assert.equal(j!.salaryMin, 40000)
  assert.equal(j!.salaryMax, 60000)
  assert.equal(j!.salaryCurrency, "USD")
  assert.equal(j!.employmentType, "Contract/Temporary")
  assert.equal(j!.description, "Assemble things.")
})

test("adecco: mapJob uses applyUri when present", () => {
  const j = mapJob({ ...job("US_1", "X", "Y"), applyUri: "https://client.example.com/apply/9" })
  assert.equal(j!.applyUrl, "https://client.example.com/apply/9")
})

test("adecco: fetchJobs paginates via range and stops on a short page", async () => {
  const ranges: number[] = []
  const result = await adeccoAdapter.fetchJobs({
    slug: "adecco",
    ctx: { etag: null, lastModified: null, fetchImpl: makeFetch(25, (r) => ranges.push(r)) },
  })
  assert.equal(result.sourceAts, "adecco")
  assert.equal(result.jobs.length, 25)
  assert.deepEqual(ranges, [0, 10, 20]) // 25 total → pages at range 0,10,20 (last short → stop)
  assert.equal(result.jobs[0]?.externalId, "adecco:US_1000")
})

test("adecco: fetchJobs throws when the first request errors", async () => {
  const fetchImpl = (async () => new Response("err", { status: 500 })) as unknown as typeof fetch
  await assert.rejects(
    adeccoAdapter.fetchJobs({ slug: "adecco", ctx: { etag: null, lastModified: null, fetchImpl } }),
    /adecco fetch failed/
  )
})
