import { strict as assert } from "node:assert"
import { test } from "node:test"
import { breezyAdapter } from "./breezy"

test("breezy: detectFromUrl resolves a {slug}.breezy.hr URL", () => {
  assert.deepEqual(breezyAdapter.detectFromUrl("https://fathom.breezy.hr/"), { slug: "fathom" })
  assert.deepEqual(
    breezyAdapter.detectFromUrl("https://10-4-truck-recruiting.breezy.hr/p/abc-role"),
    { slug: "10-4-truck-recruiting" }
  )
})

test("breezy: detectFromUrl rejects the marketing site + infra subdomains", () => {
  assert.equal(breezyAdapter.detectFromUrl("https://breezy.hr/"), null)
  assert.equal(breezyAdapter.detectFromUrl("https://www.breezy.hr/"), null)
  assert.equal(breezyAdapter.detectFromUrl("https://app.breezy.hr/"), null)
})

test("breezy: detectFromUrl rejects non-Breezy hosts", () => {
  assert.equal(breezyAdapter.detectFromUrl("https://acme.recruitee.com/"), null)
})

test("breezy: fetchJobs maps the bare-array positions payload", async () => {
  const payload = [
    {
      id: "77078545d414",
      name: "Android Developer",
      url: "https://1001.breezy.hr/p/77078545d414-android-developer",
      published_date: "2023-08-22T11:14:51.803Z",
      type: { id: "fullTime", name: "Full-Time" },
      location: {
        country: { name: "Iraq", id: "IQ" },
        city: "Baghdad/Erbil",
        is_remote: true,
        name: "Baghdad/Erbil, IQ",
      },
      department: "Engineering",
      salary: "",
    },
    // Missing url → skipped.
    { id: "x", name: "No URL" },
  ]
  const fetchImpl = (async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  const result = await breezyAdapter.fetchJobs({
    slug: "1001",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.sourceAts, "breezy")
  assert.equal(result.jobs.length, 1)
  const job = result.jobs[0]
  assert.equal(job.externalId, "breezy:77078545d414")
  assert.equal(job.title, "Android Developer")
  assert.equal(job.applyUrl, "https://1001.breezy.hr/p/77078545d414-android-developer")
  assert.equal(job.location, "Baghdad/Erbil, IQ")
  assert.equal(job.workMode, "remote")
  assert.equal(job.employmentType, "FULL_TIME")
  assert.match(job.contentHash, /^[0-9a-f]{32}$/)
})

test("breezy: fetchJobs treats a non-array body as an empty board", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ redirect: "marketing" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch

  const result = await breezyAdapter.fetchJobs({
    slug: "somemarketingredirect",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.jobs.length, 0)
})
