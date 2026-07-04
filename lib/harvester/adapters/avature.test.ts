import { strict as assert } from "node:assert"
import { test } from "node:test"
import { avatureAdapter, buildSearchUrl, extractJobs, mapLinkToJob } from "./avature"

test("avature: detectFromUrl accepts <company>.avature.net/careers", () => {
  assert.deepEqual(
    avatureAdapter.detectFromUrl("https://acme.avature.net/careers"),
    { slug: "acme" }
  )
})

test("avature: detectFromUrl rejects www + bare + non-avature hosts + malformed", () => {
  assert.equal(avatureAdapter.detectFromUrl("https://www.avature.net/"), null)
  assert.equal(avatureAdapter.detectFromUrl("https://avature.net/"), null)
  assert.equal(avatureAdapter.detectFromUrl("https://www.example.com/careers/acme"), null)
  assert.equal(avatureAdapter.detectFromUrl("not a url"), null)
})

test("avature: buildSearchUrl encodes subdomain + jobOffset", () => {
  const p0 = new URL(buildSearchUrl("acme-co"))
  assert.equal(p0.hostname, "acme-co.avature.net")
  assert.match(p0.pathname, /\/careers\/SearchJobs$/)
  assert.equal(p0.searchParams.get("jobOffset"), null)

  const p2 = new URL(buildSearchUrl("acme-co", 24))
  assert.equal(p2.searchParams.get("jobOffset"), "24")
})

test("avature: extractJobs parses JobDetail anchors, dedups, ignores non-job links", () => {
  const html = `
    <h3 class="title"><a class="link" href="https://acme.avature.net/careers/JobDetail/Software-Engineer-London/7788">Software Engineer, London</a></h3>
    <a href="https://acme.avature.net/careers/SaveJob?jobId=7788">Save</a>
    <h3 class="title"><a href="https://acme.avature.net/en_GB/careers/JobDetail/Data-Scientist-Remote/900"></a></h3>
    <a href="https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Facme.avature.net%2Fcareers%2FJobDetail%2FSoftware-Engineer-London%2F7788">Share</a>
    <h3 class="title"><a href="https://acme.avature.net/careers/JobDetail/Duplicate/7788">dupe</a></h3>
  `
  const jobs = extractJobs(html, "acme.avature.net")
  assert.equal(jobs.length, 2)
  assert.equal(jobs[0].jobId, "7788")
  assert.equal(jobs[0].title, "Software Engineer, London")
  assert.equal(jobs[0].url, "https://acme.avature.net/careers/JobDetail/Software-Engineer-London/7788")
  // Empty anchor text falls back to the de-slugged URL title; locale path still matches.
  assert.equal(jobs[1].jobId, "900")
  assert.equal(jobs[1].title, "Data Scientist Remote")
})

test("avature: mapLinkToJob builds externalId + applyUrl", () => {
  const job = mapLinkToJob("acme", {
    jobId: "7788",
    title: "Software Engineer",
    url: "https://acme.avature.net/careers/JobDetail/Software-Engineer/7788",
  })
  assert.equal(job.externalId, "avature:acme:7788")
  assert.equal(job.title, "Software Engineer")
  assert.match(job.applyUrl, /acme\.avature\.net\/careers\/JobDetail\/Software-Engineer\/7788/)
  assert.ok(job.contentHash)
})

function jobAnchor(id: number, title: string): string {
  return `<h3 class="title"><a class="link" href="https://acme.avature.net/careers/JobDetail/${title.replace(/\s+/g, "-")}/${id}">${title}</a></h3>`
}

test("avature: fetchJobs scrapes HTML + paginates via jobOffset", async () => {
  const ids = [100, 101, 102, 103, 104] // 5 jobs, 2 per page
  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const offset = Number(new URL(raw).searchParams.get("jobOffset") ?? "0")
    const slice = ids.slice(offset, offset + 2)
    const html = slice.map((id, i) => jobAnchor(id, `Job ${offset + i + 1}`)).join("\n")
    return new Response(`<html><body>${html}</body></html>`, {
      headers: { "content-type": "text/html" },
    })
  }

  const result = await avatureAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(result.sourceAts, "avature")
  assert.equal(result.sourceAtsSlug, "acme")
  assert.equal(result.notModified, false)
  assert.equal(result.jobs.length, 5)
  assert.equal(result.jobs[0]?.externalId, "avature:acme:100")
  assert.equal(result.jobs[4]?.externalId, "avature:acme:104")
})

test("avature: fetchJobs returns notModified on 304", async () => {
  const fetchImpl: typeof fetch = async () => new Response(null, { status: 304 })
  const result = await avatureAdapter.fetchJobs({
    slug: "acme",
    ctx: { etag: '"abc"', lastModified: null, fetchImpl },
  })
  assert.equal(result.notModified, true)
  assert.equal(result.jobs.length, 0)
})

test("avature: fetchJobs throws on first-page error", async () => {
  const fetchImpl: typeof fetch = async () => new Response("nope", { status: 404 })
  await assert.rejects(
    avatureAdapter.fetchJobs({
      slug: "acme",
      ctx: { etag: null, lastModified: null, fetchImpl },
    }),
    /avature fetch failed/
  )
})
