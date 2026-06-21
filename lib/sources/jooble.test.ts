import test from "node:test"
import assert from "node:assert/strict"
import { mapJoobleJob, searchJoobleJobs, stableIdFromUrl } from "@/lib/sources/jooble"

const rawJob = {
  id: 555,
  title: "Data Engineer",
  location: "Remote, US",
  snippet: "Build pipelines.",
  salary: "$130,000",
  source: "indeed.com",
  type: "Full-time",
  link: "https://jooble.org/away/555",
  company: "DataCo",
  updated: "2026-06-05T10:30:00Z",
}

test("mapJoobleJob normalizes a representative raw row", () => {
  const job = mapJoobleJob(rawJob)
  assert.ok(job)
  assert.equal(job.id, "555")
  assert.equal(job.title, "Data Engineer")
  assert.equal(job.company, "DataCo")
  assert.equal(job.location, "Remote, US")
  assert.equal(job.applyUrl, "https://jooble.org/away/555")
  assert.equal(job.postedAt, "2026-06-05T10:30:00.000Z")
  assert.equal(job.employmentType, "full-time")
  assert.equal(job.source, "indeed.com")
  assert.equal(job.isRemote, true)
})

test("mapJoobleJob synthesizes a stable id from link when id is absent", () => {
  const job = mapJoobleJob({ ...rawJob, id: undefined })
  assert.ok(job)
  assert.equal(job.id, stableIdFromUrl(rawJob.link))
  assert.match(job.id, /^jooble-/)
})

test("mapJoobleJob returns null when required fields are missing", () => {
  assert.equal(mapJoobleJob({ title: "no link" }), null)
  assert.equal(mapJoobleJob({ link: "https://x" }), null)
  assert.equal(mapJoobleJob({}), null)
})

test("searchJoobleJobs maps results via injected fetchImpl and test key", async () => {
  const captured: { value: { url: string; init: RequestInit | undefined } | null } = {
    value: null,
  }
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
    captured.value = { url: String(url), init }
    return new Response(JSON.stringify({ jobs: [rawJob, { title: "junk" }], totalCount: 7 }))
  }
  const result = await searchJoobleJobs({
    keywords: "data",
    location: "US",
    apiKey: "TEST_KEY",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  assert.equal(result.jobs.length, 1)
  assert.equal(result.count, 7)
  assert.ok(captured.value)
  assert.equal(captured.value.url, "https://jooble.org/api/TEST_KEY")
  assert.equal(captured.value.init?.method, "POST")
  assert.match(String(captured.value.init?.body), /"keywords":"data"/)
})

test("searchJoobleJobs throws when no key is available", async () => {
  const prev = process.env.JOOBLE_API_KEY
  delete process.env.JOOBLE_API_KEY
  await assert.rejects(() => searchJoobleJobs({ keywords: "x" }), /JOOBLE_API_KEY is required/)
  if (prev !== undefined) process.env.JOOBLE_API_KEY = prev
})

test("searchJoobleJobs filters junk rows to nothing", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ jobs: [{ foo: "bar" }] }))
  const result = await searchJoobleJobs({
    keywords: "x",
    apiKey: "TEST_KEY",
    fetchImpl: fetchImpl as typeof fetch,
  })
  assert.equal(result.jobs.length, 0)
})
