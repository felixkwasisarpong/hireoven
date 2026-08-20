import { strict as assert } from "node:assert"
import { test } from "node:test"
import { harvestedToRawJobs } from "./adapter-scan"
import type { HarvestedJob } from "@/lib/harvester/adapters/_base"

const harvested = (over: Partial<HarvestedJob> = {}): HarvestedJob => ({
  externalId: "oracle:123",
  title: "Software Engineer",
  applyUrl: "https://ebxr.fa.us2.oraclecloud.com/.../job/123",
  contentHash: "abc123",
  ...over,
})

test("applyUrl becomes url so the rest of the scout is unchanged", () => {
  const [job] = harvestedToRawJobs([harvested()])
  assert.equal(job!.url, "https://ebxr.fa.us2.oraclecloud.com/.../job/123")
  assert.equal(job!.externalId, "oracle:123")
  assert.equal(job!.title, "Software Engineer")
})

test("the fields the scout filters and scores on survive the mapping", () => {
  const [job] = harvestedToRawJobs([
    harvested({
      description: "Build things.",
      location: "Dallas, TX, United States",
      postedAt: "2026-08-01",
      workMode: "hybrid",
      employmentType: "full_time",
      salaryMin: 120000,
      salaryMax: 180000,
      salaryCurrency: "USD",
    }),
  ])

  assert.equal(job!.location, "Dallas, TX, United States")
  assert.equal(job!.workMode, "hybrid")
  assert.equal(job!.employmentType, "full_time")
  assert.equal(job!.salaryMin, 120000)
  assert.equal(job!.salaryMax, 180000)
  assert.equal(job!.salaryCurrency, "USD")
  assert.equal(job!.postedAt, "2026-08-01")
  assert.equal(job!.description, "Build things.")
})

test("an empty board maps to an empty list rather than throwing", () => {
  assert.deepEqual(harvestedToRawJobs([]), [])
})

test("every job is mapped, none dropped", () => {
  const jobs = harvestedToRawJobs([
    harvested({ externalId: "a" }),
    harvested({ externalId: "b" }),
    harvested({ externalId: "c" }),
  ])
  assert.deepEqual(jobs.map((j) => j.externalId), ["a", "b", "c"])
})
