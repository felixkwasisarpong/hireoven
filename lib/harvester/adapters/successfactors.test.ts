import { strict as assert } from "node:assert"
import { test } from "node:test"
import {
  decodeSlug,
  encodeSlug,
  extractJobLinks,
  parseShardFromHost,
  successfactorsAdapter,
} from "./successfactors"

test("successfactors: detectFromUrl resolves classic CSP URL with shard + company", () => {
  assert.deepEqual(
    successfactorsAdapter.detectFromUrl(
      "https://career4.successfactors.com/career?company=novartis&career_ns=job_listing_search"
    ),
    { slug: "career4.com:novartis" }
  )
})

test("successfactors: detectFromUrl resolves CSB URL (different path, same host pattern)", () => {
  assert.deepEqual(
    successfactorsAdapter.detectFromUrl(
      "https://career10.successfactors.eu/careers?company=AcmeCorp&navBarLevel=JOB_SEARCH"
    ),
    { slug: "career10.eu:AcmeCorp" }
  )
})

test("successfactors: detectFromUrl rejects non-SF hosts and missing company param", () => {
  assert.equal(successfactorsAdapter.detectFromUrl("https://www.successfactors.com/products"), null)
  assert.equal(successfactorsAdapter.detectFromUrl("https://career.example.com/?company=acme"), null)
  assert.equal(
    successfactorsAdapter.detectFromUrl("https://career4.successfactors.com/career?career_ns=foo"),
    null
  )
  // Out-of-range shard.
  assert.equal(
    successfactorsAdapter.detectFromUrl("https://career99.successfactors.com/career?company=acme"),
    null
  )
})

test("successfactors: parseShardFromHost handles 1- and 2-digit shards on both TLDs", () => {
  assert.deepEqual(parseShardFromHost("career4.successfactors.com"), { prefix: "career4", tld: "com" })
  assert.deepEqual(parseShardFromHost("career10.successfactors.eu"), { prefix: "career10", tld: "eu" })
  assert.equal(parseShardFromHost("career.successfactors.com"), null)
  assert.equal(parseShardFromHost("career0.successfactors.com"), null)
})

test("successfactors: slug encode / decode round-trips", () => {
  const slug = encodeSlug({ prefix: "career4", tld: "com" }, "novartis")
  assert.equal(slug, "career4.com:novartis")
  const decoded = decodeSlug(slug)
  assert.ok(decoded)
  assert.equal(decoded!.shard.prefix, "career4")
  assert.equal(decoded!.shard.tld, "com")
  assert.equal(decoded!.companyId, "novartis")
})

test("successfactors: decodeSlug rejects malformed inputs", () => {
  assert.equal(decodeSlug("career4.com"), null)
  assert.equal(decodeSlug("career4:novartis"), null)
  assert.equal(decodeSlug("careerX.com:novartis"), null)
  assert.equal(decodeSlug("career4.com:has spaces"), null)
})

test("successfactors: extractJobLinks pulls career_job_req_id from anchor hrefs", () => {
  const html = `
    <table class="jobResultsListContainer">
      <tr>
        <td><a href="career?career_ns=job_application&amp;career_job_req_id=12345&amp;company=novartis">Senior Engineer</a></td>
      </tr>
      <tr>
        <td><a href="https://career4.successfactors.com/career?career_job_req_id=67890&amp;company=novartis">Product Manager</a></td>
      </tr>
      <tr>
        <td><a href="career?career_ns=job_application&amp;career_job_req_id=12345&amp;company=novartis">Senior Engineer (duplicate)</a></td>
      </tr>
      <tr>
        <td><a href="career?career_job_req_id=99&amp;company=other">Wrong company</a></td>
      </tr>
      <tr>
        <td><a href="career?career_ns=privacy">No job id</a></td>
      </tr>
    </table>
  `
  const links = extractJobLinks(html, { prefix: "career4", tld: "com" }, "novartis")
  assert.equal(links.length, 2)
  assert.equal(links[0].jobReqId, "12345")
  assert.equal(links[0].title, "Senior Engineer")
  assert.equal(
    links[0].url,
    "https://career4.successfactors.com/career?company=novartis&career_ns=job_application&career_job_req_id=12345&selected_lang=en_US"
  )
  assert.equal(links[1].jobReqId, "67890")
  assert.equal(links[1].title, "Product Manager")
})

test("successfactors: extractJobLinks accepts hrefs with no company param (inherits page)", () => {
  // SAP SF's SSR sometimes emits company-less hrefs in JS-injected fragments.
  const html = `<a href="/career?career_job_req_id=42&career_ns=job_application">Director</a>`
  const links = extractJobLinks(html, { prefix: "career4", tld: "com" }, "acme")
  assert.equal(links.length, 1)
  assert.equal(links[0].jobReqId, "42")
})

test("successfactors: fetchJobs paginates and enriches detail JSON-LD", async () => {
  const listingPage0 = `
    <div>1 job found</div>
    <a href="career?career_ns=job_application&amp;career_job_req_id=111&amp;company=acme">Data Engineer</a>
    <a href="career?next_page=1">Next</a>
  `
  const listingPage1 = `
    <a href="career?career_ns=job_application&amp;career_job_req_id=222&amp;company=acme">Designer</a>
  `
  const listingPage2 = `
    <div>End of results</div>
  `
  const detailHtml111 = `
    <script type="application/ld+json">
      {
        "@context": "http://schema.org",
        "@type": "JobPosting",
        "title": "Data Engineer",
        "datePosted": "2026-05-12",
        "description": "<p>Build pipelines.</p>",
        "jobLocation": {
          "@type": "Place",
          "address": { "addressLocality": "Boston", "addressRegion": "MA", "addressCountry": "US" }
        },
        "identifier": "111"
      }
    </script>
  `
  const fetchImpl: typeof fetch = async (input) => {
    const raw = typeof input === "string" || input instanceof URL ? input.toString() : input.url
    const url = new URL(raw)
    if (url.pathname !== "/career") return new Response("", { status: 404 })
    const page = url.searchParams.get("iCurrentPage")
    const careerNs = url.searchParams.get("career_ns")
    const jobReqId = url.searchParams.get("career_job_req_id")
    if (careerNs === "job_listing_search") {
      if (page === "0") return new Response(listingPage0)
      if (page === "1") return new Response(listingPage1)
      return new Response(listingPage2)
    }
    if (careerNs === "job_application" && jobReqId === "111") return new Response(detailHtml111)
    if (careerNs === "job_application" && jobReqId === "222") return new Response("<html></html>")
    return new Response("", { status: 404 })
  }

  const result = await successfactorsAdapter.fetchJobs({
    slug: "career4.com:acme",
    ctx: { etag: null, lastModified: null, fetchImpl },
  })

  assert.equal(result.sourceAts, "successfactors")
  assert.equal(result.sourceAtsSlug, "career4.com:acme")
  assert.equal(result.jobs.length, 2)

  const dataEng = result.jobs.find((j) => j.externalId.endsWith(":111"))
  assert.ok(dataEng, "expected data engineer in results")
  assert.equal(dataEng!.title, "Data Engineer")
  assert.equal(dataEng!.location, "Boston, MA, US")
  assert.equal(dataEng!.description, "Build pipelines.")

  const designer = result.jobs.find((j) => j.externalId.endsWith(":222"))
  assert.ok(designer, "expected designer in results")
  assert.equal(designer!.title, "Designer")
})
