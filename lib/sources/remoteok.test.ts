import test from "node:test"
import assert from "node:assert/strict"
import { mapRemoteOkJob, searchRemoteOkJobs } from "@/lib/sources/remoteok"

const legalRow = {
  legal: "Use of this data is subject to attribution.",
}

const rawJob = {
  id: "abc123",
  slug: "frontend-developer-acme",
  position: "Frontend Developer",
  company: "Acme",
  location: "Worldwide",
  url: "https://remoteok.com/remote-jobs/abc123",
  apply_url: "https://acme.com/apply",
  date: "2026-06-10T00:00:00Z",
  description: "Build UIs.",
  tags: ["react", "typescript"],
  salary_min: 90000,
  salary_max: 130000,
}

test("mapRemoteOkJob normalizes a representative raw row", () => {
  const job = mapRemoteOkJob(rawJob)
  assert.ok(job)
  assert.equal(job.id, "abc123")
  assert.equal(job.title, "Frontend Developer")
  assert.equal(job.company, "Acme")
  assert.equal(job.applyUrl, "https://acme.com/apply")
  assert.equal(job.postedAt, "2026-06-10T00:00:00Z")
  assert.equal(job.salaryMin, 90000)
  assert.equal(job.salaryMax, 130000)
  assert.equal(job.salaryCurrency, "USD")
  assert.deepEqual(job.tags, ["react", "typescript"])
  assert.equal(job.isRemote, true)
})

test("mapRemoteOkJob skips the legal/disclaimer row and junk", () => {
  assert.equal(mapRemoteOkJob(legalRow as never), null)
  assert.equal(mapRemoteOkJob({ id: "x", company: "no position" }), null)
  assert.equal(mapRemoteOkJob({ id: "x", position: "no company" }), null)
})

test("searchRemoteOkJobs skips the leading legal element via injected fetchImpl", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([legalRow, rawJob]))
  const result = await searchRemoteOkJobs({ fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.jobs.length, 1)
  assert.equal(result.count, 1)
  assert.equal(result.jobs[0].id, "abc123")
})

test("searchRemoteOkJobs filters an all-junk array to nothing", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([legalRow, { foo: "bar" }]))
  const result = await searchRemoteOkJobs({ fetchImpl: fetchImpl as typeof fetch })
  assert.equal(result.jobs.length, 0)
})
