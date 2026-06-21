import test from "node:test"
import assert from "node:assert/strict"
import { mapArbeitnowJob, searchArbeitnowJobs } from "@/lib/sources/arbeitnow"

const rawJob = {
  slug: "senior-go-developer-berlin-acme",
  title: "Senior Go Developer",
  company_name: "Acme GmbH",
  url: "https://www.arbeitnow.com/jobs/senior-go-developer-berlin-acme",
  location: "Berlin",
  remote: true,
  description: "<p>Write Go.</p>",
  created_at: 1748736000,
  job_types: ["full_time"],
  tags: ["golang", "backend"],
}

test("mapArbeitnowJob normalizes a representative raw row", () => {
  const job = mapArbeitnowJob(rawJob)
  assert.ok(job)
  assert.equal(job.id, "senior-go-developer-berlin-acme")
  assert.equal(job.title, "Senior Go Developer")
  assert.equal(job.company, "Acme GmbH")
  assert.equal(job.location, "Berlin")
  assert.equal(job.applyUrl, rawJob.url)
  assert.equal(job.postedAt, new Date(1748736000 * 1000).toISOString())
  assert.equal(job.employmentType, "full-time")
  assert.deepEqual(job.tags, ["golang", "backend"])
  assert.equal(job.isRemote, true)
})

test("mapArbeitnowJob handles ISO and numeric-string created_at", () => {
  const iso = mapArbeitnowJob({ ...rawJob, created_at: "2026-01-15T08:00:00Z" })
  assert.equal(iso?.postedAt, "2026-01-15T08:00:00.000Z")
  const numStr = mapArbeitnowJob({ ...rawJob, created_at: "1748736000" })
  assert.equal(numStr?.postedAt, new Date(1748736000 * 1000).toISOString())
})

test("mapArbeitnowJob returns null when required fields are missing", () => {
  assert.equal(mapArbeitnowJob({ slug: "s", title: "no company" }), null)
  assert.equal(mapArbeitnowJob({ title: "no slug", company_name: "X" }), null)
  assert.equal(mapArbeitnowJob({}), null)
})

test("searchArbeitnowJobs maps results via injected fetchImpl", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ data: [rawJob, { title: "junk" }] }))
  const result = await searchArbeitnowJobs({ page: 2, fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.jobs.length, 1)
  assert.equal(result.page, 2)
  assert.equal(result.jobs[0].id, "senior-go-developer-berlin-acme")
})

test("searchArbeitnowJobs filters junk rows to nothing", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ data: [{ foo: "bar" }] }))
  const result = await searchArbeitnowJobs({ fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.jobs.length, 0)
})
