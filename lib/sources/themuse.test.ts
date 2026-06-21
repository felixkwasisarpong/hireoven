import test from "node:test"
import assert from "node:assert/strict"
import { mapTheMuseJob, searchTheMuseJobs } from "@/lib/sources/themuse"

const rawJob = {
  id: 12345,
  name: "Senior Software Engineer",
  contents: "<p>Build great things.</p>",
  publication_date: "2026-06-01T12:00:00Z",
  company: { name: "Acme Corp" },
  locations: [{ name: "New York, NY" }, { name: "Flexible / Remote" }],
  levels: [{ name: "Senior Level" }],
  refs: { landing_page: "https://www.themuse.com/jobs/acme/senior-software-engineer" },
}

test("mapTheMuseJob normalizes a representative raw row", () => {
  const job = mapTheMuseJob(rawJob)
  assert.ok(job)
  assert.equal(job.id, "12345")
  assert.equal(job.title, "Senior Software Engineer")
  assert.equal(job.company, "Acme Corp")
  assert.equal(job.location, "New York, NY, Flexible / Remote")
  assert.equal(job.applyUrl, "https://www.themuse.com/jobs/acme/senior-software-engineer")
  assert.equal(job.postedAt, "2026-06-01T12:00:00Z")
  assert.equal(job.employmentType, "Senior Level")
  assert.equal(job.isRemote, true)
})

test("mapTheMuseJob returns null when required fields are missing", () => {
  assert.equal(mapTheMuseJob({ id: 1, name: "No company" }), null)
  assert.equal(mapTheMuseJob({ name: "No id", company: { name: "X" } }), null)
  assert.equal(mapTheMuseJob({}), null)
})

test("searchTheMuseJobs maps results via injected fetchImpl", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ results: [rawJob, { id: 2, name: "junk" }], page_count: 100 }))

  const result = await searchTheMuseJobs({ page: 0, fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.jobs.length, 1)
  assert.equal(result.count, 100)
  assert.equal(result.page, 0)
  assert.equal(result.jobs[0].title, "Senior Software Engineer")
})

test("searchTheMuseJobs filters junk rows to nothing", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ results: [{ foo: "bar" }, { id: 9 }] }))
  const result = await searchTheMuseJobs({ fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.jobs.length, 0)
})
