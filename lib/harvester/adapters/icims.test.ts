import { strict as assert } from "node:assert"
import { test } from "node:test"
import { icimsAdapter, extractJobLinks } from "./icims"

test("icims: detectFromUrl resolves a careers-{tenant}.icims.com URL", () => {
  assert.deepEqual(
    icimsAdapter.detectFromUrl("https://careers-iridium.icims.com/jobs/search?ss=1"),
    { slug: "careers-iridium.icims.com" }
  )
})

test("icims: detectFromUrl accepts uscareers-* / careersat-* / earlycareers-* hosts", () => {
  for (const host of [
    "uscareers-yelp.icims.com",
    "careersat-ohsu.icims.com",
    "earlycareers-arm.icims.com",
    "tuftscareers.icims.com",
  ]) {
    assert.deepEqual(icimsAdapter.detectFromUrl(`https://${host}/`), { slug: host })
  }
})

test("icims: detectFromUrl rejects bare apex + asset / community subdomains", () => {
  for (const url of [
    "https://icims.com/legal/privacy-notice-website/",
    "https://www.icims.com/",
    "https://cdn02.icims.com/a/images/icon.png",
    "https://cookie-policy-scripts.icims.com/customer/foo/script.js",
    "https://community.icims.com/s/",
    "https://api.icims.com/v1/...",
  ]) {
    assert.equal(icimsAdapter.detectFromUrl(url), null, url)
  }
})

test("icims: detectFromUrl rejects employee / auth portals", () => {
  for (const url of [
    "https://mxemployees-napanasonic.icims.com/",
    "https://caemployees-napanasonic.icims.com/",
    "https://faculty-saintmarysuniversity.icims.com/",
    "https://login-dollargeneral.icims.com/",
  ]) {
    assert.equal(icimsAdapter.detectFromUrl(url), null, url)
  }
})

test("icims: detectFromUrl accepts internal-* portals (e.g. Liberty Mutual's public board)", () => {
  assert.deepEqual(
    icimsAdapter.detectFromUrl("https://internal-libertymutual.icims.com/jobs/search"),
    { slug: "internal-libertymutual.icims.com" }
  )
  assert.deepEqual(
    icimsAdapter.detectFromUrl("https://internal-tuftscareers.icims.com/"),
    { slug: "internal-tuftscareers.icims.com" }
  )
})

test("icims: extractJobLinks parses iCIMS_Anchor tags regardless of attribute order", () => {
  const html = `
    <a class="iCIMS_Anchor" href="https://careers-acme.icims.com/jobs/4964/software-engineer-i-%28test-automation-developer%29/job?in_iframe=1" title="4964 - Software Engineer I (Test Automation Developer)">
    <a href="https://careers-acme.icims.com/jobs/4957/principal-engineer/job?in_iframe=1" class="iCIMS_Anchor" title="4957 - Principal Engineer">
    <a class="iCIMS_Anchor" href="https://careers-acme.icims.com/jobs/4957/principal-engineer/job?in_iframe=1" title="4957 - Principal Engineer">
  `
  const links = extractJobLinks(html, "careers-acme.icims.com")
  assert.equal(links.length, 2)
  assert.equal(links[0].jobId, "4964")
  assert.equal(links[0].title, "Software Engineer I (Test Automation Developer)")
  assert.ok(!links[0].url.includes("in_iframe"), "apply URL should not retain in_iframe")
  assert.equal(links[1].jobId, "4957")
  assert.equal(links[1].title, "Principal Engineer")
})

test("icims: extractJobLinks accepts hub-federated cross-host links within *.icims.com", () => {
  const html = `
    <a class="iCIMS_Anchor" href="https://externalcareers-acme.icims.com/jobs/12/role/job?hub=6&in_iframe=1" title="12 - Role">
    <a class="iCIMS_Anchor" href="/legal/privacy" title="Privacy">
    <a class="iCIMS_Anchor" href="/jobs/dashboard/" title="Dashboard">
    <a class="iCIMS_Anchor" href="https://careers-acme.icims.com/jobs/77/role/job?in_iframe=1" title="77 - Role">
  `
  const links = extractJobLinks(html, "careersat-acme.icims.com")
  assert.equal(links.length, 2)
  // Each is keyed by its actual host
  const hosts = new Set(links.map((l) => l.host))
  assert.ok(hosts.has("externalcareers-acme.icims.com"))
  assert.ok(hosts.has("careers-acme.icims.com"))
})

test("icims: extractJobLinks rejects non-icims.com hosts", () => {
  const html = `
    <a class="iCIMS_Anchor" href="https://other.example.com/jobs/1/title/job" title="1 - Job">
  `
  const links = extractJobLinks(html, "careers-acme.icims.com")
  assert.equal(links.length, 0)
})

test("icims: fetchJobs falls back to detail HTML descriptions without JSON-LD", async () => {
  const searchHtml = `
    <a class="iCIMS_Anchor" href="https://careers-acme.icims.com/jobs/23007/verizon-sales-consultant/job?in_iframe=1" title="23007 - Verizon Sales Consultant">
  `
  const detailHtml = `
    <html><body>
      <div class="iCIMS_JobDescription">
        <p>Cellular Sales is growing and this Verizon Sales Consultant role helps customers choose wireless plans, devices, and accessories.</p>
        <p>Responsibilities include building customer relationships, explaining product options, meeting sales goals, and maintaining accurate account notes.</p>
        <p>Requirements include communication skills, retail sales experience, schedule flexibility, and comfort learning new technology every week.</p>
      </div>
    </body></html>
  `
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/jobs/search?pr=0")) return new Response(searchHtml, { status: 200 })
    if (url.includes("/jobs/search?pr=1")) return new Response("", { status: 200 })
    return new Response(detailHtml, { status: 200 })
  }

  const result = await icimsAdapter.fetchJobs({
    slug: "careers-acme.icims.com",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.jobs.length, 1)
  assert.match(result.jobs[0].externalId, /^icims:careers-acme\.icims\.com:23007$/)
  assert.match(result.jobs[0].description ?? "", /Responsibilities include building customer relationships/)
})

const LIVE = process.env.HARVESTER_LIVE_TESTS === "1"
const LIVE_SLUG = process.env.HARVESTER_LIVE_ICIMS_SLUG ?? "careers-iridium.icims.com"

test(
  "icims: live fetch returns a shaped response",
  { skip: !LIVE },
  async () => {
    let result
    try {
      result = await icimsAdapter.fetchJobs({
        slug: LIVE_SLUG,
        ctx: { etag: null, lastModified: null },
      })
    } catch (error) {
      if ((error as { status?: number | null }).status === 404) return
      throw error
    }
    assert.equal(result.sourceAts, "icims")
    assert.ok(Array.isArray(result.jobs))
    if (result.jobs.length > 0) {
      const sample = result.jobs[0]
      assert.match(sample.externalId, /^icims:.+:\d+$/)
      assert.match(sample.applyUrl, /^https?:\/\//)
      assert.match(sample.contentHash, /^[0-9a-f]{32}$/)
    }
  }
)

test("icims: change-detection skips detail fetches when listing unchanged + all described", async () => {
  const searchHtml = `<a class="iCIMS_Anchor" href="https://careers-acme.icims.com/jobs/23007/role/job?in_iframe=1" title="23007 - Role">`
  const detailHtml = `<html><body><div class="iCIMS_JobDescription"><p>Responsibilities include building customer relationships, explaining product options, meeting goals, and maintaining accurate notes across a busy retail floor every single week.</p></div></body></html>`
  let detailFetches = 0
  const fetchImpl = async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/jobs/search?pr=0")) return new Response(searchHtml, { status: 200 })
    if (url.includes("/jobs/search?pr=1")) return new Response("", { status: 200 })
    detailFetches += 1
    return new Response(detailHtml, { status: 200 })
  }

  const first = await icimsAdapter.fetchJobs({
    slug: "careers-acme.icims.com",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })
  assert.equal(first.notModified, false)
  assert.ok(first.etag && first.etag.startsWith("icimsv1:"), "stores a listing fingerprint")
  assert.ok(detailFetches >= 1, "pass 1 fetched the detail page")
  const afterFirst = detailFetches

  // pass 2: same listing, etag matches, and the job already has a description in the DB
  const second = await icimsAdapter.fetchJobs({
    slug: "careers-acme.icims.com",
    ctx: {
      etag: first.etag,
      lastModified: null,
      fetchImpl,
      alreadyDescribedIds: new Set(["icims:careers-acme.icims.com:23007"]),
    },
  })
  assert.equal(second.notModified, true, "unchanged + fully-described board short-circuits")
  assert.equal(second.jobs.length, 0)
  assert.equal(second.etag, first.etag)
  assert.equal(detailFetches - afterFirst, 0, "pass 2 does ZERO detail fetches (the rate-limited part)")
})
